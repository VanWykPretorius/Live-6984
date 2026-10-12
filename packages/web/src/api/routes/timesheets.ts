import { ORPCError } from "@orpc/server";
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import { z } from "zod";
import { base } from "../__core/app";
import { auth } from "../auth";
import { db } from "../database";
import { farmEmployees, farmProjects, timesheetDays, type TimeEntry } from "../database/schema";
import { manager } from "../middleware/manager";
import { toCsv } from "../lib/csv";

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  }, "Choose a valid date");
const id = z.number().int().positive();
const range = z
  .object({ from: dateSchema, to: dateSchema })
  .refine((r) => r.to >= r.from, "End date must follow start date");
const today = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Johannesburg" }).format(new Date());
const safeCell = (value: string) => (/^[\s]*[=+@-]/.test(value) ? `'${value}` : value);

async function loadDay(employeeId: number, date: string) {
  const [day] = await db
    .select()
    .from(timesheetDays)
    .where(and(eq(timesheetDays.employeeId, employeeId), eq(timesheetDays.date, date)));
  return day ?? null;
}
async function ranged(from: string, to: string) {
  return db
    .select({ day: timesheetDays, employee: farmEmployees.name })
    .from(timesheetDays)
    .innerJoin(farmEmployees, eq(farmEmployees.id, timesheetDays.employeeId))
    .where(and(gte(timesheetDays.date, from), lte(timesheetDays.date, to)))
    .orderBy(desc(timesheetDays.date), asc(farmEmployees.name));
}

export const timesheets = {
  // Name selection is intentional: this endpoint is for a trusted shared farm device.
  options: base.handler(async () => ({
    employees: await db
      .select()
      .from(farmEmployees)
      .where(eq(farmEmployees.active, true))
      .orderBy(asc(farmEmployees.id)),
    projects: await db
      .select()
      .from(farmProjects)
      .where(eq(farmProjects.active, true))
      .orderBy(asc(farmProjects.name)),
    today: today(),
  })),
  day: base
    .input(z.object({ employeeId: id, date: dateSchema }))
    .handler(({ input }) => loadDay(input.employeeId, input.date)),
  history: base
    .input(z.object({ employeeId: id, from: dateSchema, to: dateSchema }))
    .handler(({ input }) =>
      db
        .select()
        .from(timesheetDays)
        .where(
          and(
            eq(timesheetDays.employeeId, input.employeeId),
            gte(timesheetDays.date, input.from),
            lte(timesheetDays.date, input.to),
          ),
        )
        .orderBy(desc(timesheetDays.date)),
    ),
  save: base
    .input(
      z.object({
        employeeId: id,
        date: dateSchema,
        revision: z.number().int().min(0),
        action: z.enum(["draft", "submit"]),
        entries: z
          .array(
            z.object({
              projectId: id,
              minutes: z.number().int().min(1).max(1440),
              description: z.string().trim().min(1).max(500),
            }),
          )
          .min(1)
          .max(30),
      }),
    )
    .handler(async ({ input }) => {
      if (input.date > today())
        throw new ORPCError("BAD_REQUEST", { message: "You cannot log time for a future day." });
      const [employee] = await db
        .select()
        .from(farmEmployees)
        .where(and(eq(farmEmployees.id, input.employeeId), eq(farmEmployees.active, true)));
      if (!employee) throw new ORPCError("BAD_REQUEST", { message: "Choose an active employee." });
      const existing = await loadDay(input.employeeId, input.date);
      if (existing && !["draft", "returned"].includes(existing.status))
        throw new ORPCError("CONFLICT", {
          message:
            "This day is submitted or approved and is locked. Ask your manager to return it.",
        });
      if ((existing?.revision ?? 0) !== input.revision)
        throw new ORPCError("CONFLICT", {
          message: "This day changed on another device. Reload before saving.",
        });
      const totalMinutes = input.entries.reduce((n, e) => n + e.minutes, 0);
      if (totalMinutes > 1440)
        throw new ORPCError("BAD_REQUEST", { message: "A day cannot contain more than 24 hours." });
      const projects = await db.select().from(farmProjects);
      const entries: TimeEntry[] = input.entries.map((e) => {
        const project = projects.find((p) => p.id === e.projectId);
        const retained = existing?.entries.some((old) => old.projectId === e.projectId);
        if (!project || (!project.active && !retained))
          throw new ORPCError("BAD_REQUEST", { message: "Choose an active project." });
        return { ...e, project: project.name };
      });
      const at = new Date().toISOString();
      const event = {
        action: input.action === "submit" ? "submitted" : "draft saved",
        at,
        actor: employee.name,
        note: "",
        entries,
      };
      const values = {
        entries,
        totalMinutes,
        status:
          input.action === "submit"
            ? "submitted"
            : existing?.status === "returned"
              ? "returned"
              : "draft",
        revision: input.revision + 1,
        updatedAt: at,
        audit: [...(existing?.audit ?? []), event],
      };
      if (existing) {
        const [saved] = await db
          .update(timesheetDays)
          .set(values)
          .where(and(eq(timesheetDays.id, existing.id), eq(timesheetDays.revision, input.revision)))
          .returning();
        if (!saved)
          throw new ORPCError("CONFLICT", { message: "This day changed. Reload before saving." });
        return saved;
      }
      const [saved] = await db
        .insert(timesheetDays)
        .values({ ...values, employeeId: employee.id, date: input.date })
        .onConflictDoNothing()
        .returning();
      if (!saved)
        throw new ORPCError("CONFLICT", {
          message: "This day was already created. Reload before saving.",
        });
      return saved;
    }),
  managerSession: manager.handler(({ context }) => ({
    email: context.manager.email,
    name: context.manager.name,
  })),
  setPassword: manager
    .input(z.object({ password: z.string().min(12).max(128) }))
    .handler(async ({ input, context }) => {
      await auth.api.setPassword({
        headers: context.headers,
        body: { newPassword: input.password },
      });
      return { success: true };
    }),
  reviewList: manager.input(range).handler(({ input }) => ranged(input.from, input.to)),
  review: manager
    .input(
      z.object({
        dayId: id,
        revision: z.number().int().positive(),
        action: z.enum(["approve", "return"]),
        note: z.string().trim().max(500).default(""),
      }),
    )
    .handler(async ({ input, context }) => {
      const [day] = await db.select().from(timesheetDays).where(eq(timesheetDays.id, input.dayId));
      if (!day) throw new ORPCError("NOT_FOUND");
      if (day.revision !== input.revision)
        throw new ORPCError("CONFLICT", { message: "This day changed. Reload the review." });
      if (input.action === "approve" && day.status !== "submitted")
        throw new ORPCError("CONFLICT", { message: "Only submitted days can be approved." });
      if (input.action === "return" && !["submitted", "approved"].includes(day.status))
        throw new ORPCError("CONFLICT", {
          message: "Only submitted or approved days can be returned.",
        });
      if (input.action === "return" && !input.note)
        throw new ORPCError("BAD_REQUEST", {
          message: "Add a note explaining what needs correcting.",
        });
      const at = new Date().toISOString();
      const [updated] = await db
        .update(timesheetDays)
        .set({
          status: input.action === "approve" ? "approved" : "returned",
          returnNote: input.action === "return" ? input.note : "",
          reviewedBy: context.manager.email,
          reviewedAt: at,
          updatedAt: at,
          revision: day.revision + 1,
          audit: [
            ...day.audit,
            {
              action: input.action === "approve" ? "approved" : "returned",
              at,
              actor: context.manager.email,
              note: input.note,
            },
          ],
        })
        .where(and(eq(timesheetDays.id, day.id), eq(timesheetDays.revision, input.revision)))
        .returning();
      if (!updated)
        throw new ORPCError("CONFLICT", { message: "This day changed. Reload the review." });
      return updated;
    }),
  deleteDay: manager
    .input(z.object({ dayId: id }))
    .handler(async ({ input, context }) => {
      const [day] = await db.select().from(timesheetDays).where(eq(timesheetDays.id, input.dayId));
      if (!day) throw new ORPCError("NOT_FOUND");
      // Destructive and unrecoverable — require the manager to type the day back.
      await db.delete(timesheetDays).where(eq(timesheetDays.id, day.id));
      console.warn(
        `timesheet day ${day.id} (${day.date}, employee ${day.employeeId}, ${day.status}, ${day.totalMinutes}min) deleted by ${context.manager.email}`,
      );
      return { deleted: true };
    }),
  setup: manager.handler(async () => ({
    employees: await db.select().from(farmEmployees).orderBy(asc(farmEmployees.id)),
    projects: await db.select().from(farmProjects).orderBy(asc(farmProjects.name)),
  })),
  saveEmployee: manager
    .input(
      z.object({
        id: id.optional(),
        name: z.string().trim().min(1).max(100),
        active: z.boolean().default(true),
      }),
    )
    .handler(async ({ input }) => {
      try {
        if (input.id)
          return (
            await db
              .update(farmEmployees)
              .set({ name: input.name, active: input.active })
              .where(eq(farmEmployees.id, input.id))
              .returning()
          )[0];
        return (await db.insert(farmEmployees).values({ name: input.name }).returning())[0];
      } catch {
        throw new ORPCError("BAD_REQUEST", { message: "That employee name is already in use." });
      }
    }),
  saveProject: manager
    .input(
      z.object({
        id: id.optional(),
        name: z.string().trim().min(1).max(100),
        active: z.boolean().default(true),
      }),
    )
    .handler(async ({ input }) => {
      try {
        if (input.id)
          return (
            await db
              .update(farmProjects)
              .set({ name: input.name, active: input.active })
              .where(eq(farmProjects.id, input.id))
              .returning()
          )[0];
        return (await db.insert(farmProjects).values({ name: input.name }).returning())[0];
      } catch {
        throw new ORPCError("BAD_REQUEST", { message: "That project name is already in use." });
      }
    }),
  exportCsv: manager.input(range).handler(async ({ input }) => {
    const days = await ranged(input.from, input.to);
    return {
      fileName: `timesheets-${input.from}-${input.to}.csv`,
      csv: toCsv(
        [
          "Employee",
          "Date",
          "Status",
          "Xero tracking option",
          "Minutes",
          "Hours",
          "Description",
          "Reviewer",
          "Return note",
        ],
        days.flatMap(({ day, employee }) =>
          day.entries.map((e) => [
            safeCell(employee),
            day.date,
            day.status,
            safeCell(e.project),
            e.minutes,
            Math.round((e.minutes / 60) * 10000) / 10000,
            safeCell(e.description),
            day.reviewedBy ?? "",
            safeCell(day.returnNote),
          ]),
        ),
      ),
    };
  }),
};
