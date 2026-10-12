import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowLeft, ArrowRight, Check, Clock3, Plus, Sprout, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Banner, Card, Chip, Loading } from "@/components/ui/misc";
import {
  useTimeDay,
  useTimeHistory,
  useTimeOptions,
  useSaveTime,
  useClearManagerCache,
} from "@/queries/timesheets";
import { errorMessage, shortDate, weekRange } from "@/lib/format";
import { farmToday, projectLabel, timeLabel } from "@/lib/timesheets";
import { managerToken, signOutManager } from "@/lib/auth";
import type { timesheetDays } from "../../api/database/schema";

type Day = typeof timesheetDays.$inferSelect;
type EntryDraft = {
  key: string;
  projectId: string;
  hours: string;
  minutes: string;
  description: string;
};
const blank = (): EntryDraft => ({
  key: crypto.randomUUID(),
  projectId: "",
  hours: "",
  minutes: "",
  description: "",
});

function DayGuide({
  employee,
  date,
  saved,
  projects,
  onExit,
}: {
  employee: { id: number; name: string };
  date: string;
  saved: Day | null;
  projects: { id: number; name: string }[];
  onExit: () => void;
}) {
  const [step, setStep] = useState(1);
  const [day, setDay] = useState(saved);
  const [rows, setRows] = useState<EntryDraft[]>(
    saved?.entries.map((e) => ({
      key: crypto.randomUUID(),
      projectId: String(e.projectId),
      hours: String(Math.floor(e.minutes / 60)),
      minutes: String(e.minutes % 60),
      description: e.description,
    })) ?? [blank()],
  );
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [done, setDone] = useState(false);
  const [edited, setEdited] = useState(false);
  const save = useSaveTime();
  const locked = !!day && ["submitted", "approved"].includes(day.status);
  const total = rows.reduce(
    (n, r) => n + (Number(r.hours) || 0) * 60 + (Number(r.minutes) || 0),
    0,
  );
  const options = [...projects];
  for (const e of saved?.entries ?? [])
    if (!options.some((p) => p.id === e.projectId))
      options.push({ id: e.projectId, name: e.project });
  function update(key: string, values: Partial<EntryDraft>) {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...values } : r)));
    setMessage("");
    setEdited(true);
  }
  function exit() {
    if (
      !locked &&
      edited &&
      !window.confirm(
        "Leave this day? Unsaved changes will be lost. Save a draft first to keep them.",
      )
    )
      return;
    onExit();
  }
  function validate() {
    for (const r of rows) {
      const h = Number(r.hours || 0),
        m = Number(r.minutes || 0);
      if (!r.projectId) return "Choose a project for every entry.";
      if (
        !Number.isInteger(h) ||
        h < 0 ||
        h > 24 ||
        !Number.isInteger(m) ||
        m < 0 ||
        m > 59 ||
        h * 60 + m <= 0
      )
        return "Enter hours and minutes for each project. Minutes must be between 0 and 59.";
      if (!r.description.trim()) return "Briefly describe what you did for each entry.";
    }
    return total > 1440 ? "The daily total cannot be more than 24 hours." : "";
  }
  async function persist(action: "draft" | "submit") {
    const invalid = validate();
    setError(invalid);
    if (invalid) return;
    try {
      const result = await save.mutateAsync({
        employeeId: employee.id,
        date,
        revision: day?.revision ?? 0,
        action,
        entries: rows.map((r) => ({
          projectId: Number(r.projectId),
          minutes: Number(r.hours || 0) * 60 + Number(r.minutes || 0),
          description: r.description.trim(),
        })),
      });
      setDay(result);
      setEdited(false);
      setMessage("Draft saved. You can come back to this day later.");
      if (action === "submit") setDone(true);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  if (done)
    return (
      <Card className="p-7 text-center">
        <div className="mx-auto mb-4 flex size-14 items-center justify-center rounded-full bg-leaf/12 text-leaf">
          <Check className="size-7" />
        </div>
        <h1 className="font-display text-3xl text-primary">Thank you, {employee.name}.</h1>
        <p className="my-3 text-sm text-muted-foreground">
          Your {timeLabel(total)} for {shortDate(date)} has been submitted for manager review.
        </p>
        <p className="mb-6 text-xs text-muted-foreground">
          Need a correction? Ask the manager to return the day to you.
        </p>
        <Button size="lg" className="w-full" onClick={onExit}>
          Finish · next employee
        </Button>
      </Card>
    );
  return (
    <>
      <button
        type="button"
        onClick={exit}
        className="mb-4 flex min-h-11 items-center gap-2 text-sm text-muted-foreground"
      >
        <ArrowLeft className="size-4" /> Change employee or day
      </button>
      <div className="mb-5 flex items-start justify-between">
        <div>
          <h1 className="font-display text-3xl text-primary">{employee.name}’s day</h1>
          <p className="mt-1 text-sm text-muted-foreground">{shortDate(date)}</p>
        </div>
        {day && (
          <Chip
            tone={day.status === "approved" ? "good" : day.status === "returned" ? "warn" : "info"}
          >
            {day.status}
          </Chip>
        )}
      </div>
      {day?.status === "returned" && (
        <div className="mb-4">
          <Banner tone="warn">Please correct this day: {day.returnNote}</Banner>
        </div>
      )}
      {locked ? (
        <Card className="p-5">
          <h2 className="font-display text-xl text-primary">
            {day?.status === "approved" ? "Approved and locked" : "Waiting for manager review"}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            This day cannot be edited unless the manager returns it.
          </p>
          {day?.entries.map((e, i) => (
            <div key={`${e.projectId}-${i}`} className="mt-4 border-t border-border pt-3">
              <div className="flex justify-between gap-3 font-semibold">
                <span>{projectLabel(e.project)}</span>
                <span>{timeLabel(e.minutes)}</span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{e.description}</p>
            </div>
          ))}
          <div className="mt-5 border-t border-border pt-4 font-semibold">
            Total: {timeLabel(day?.totalMinutes ?? 0)}
          </div>
        </Card>
      ) : (
        <>
          <div className="mb-5 flex items-center gap-2 text-xs font-semibold">
            <span className="rounded-full bg-primary px-3 py-2 text-primary-foreground">
              1 · Who & when
            </span>
            <span
              className={`rounded-full px-3 py-2 ${step === 1 ? "bg-accent text-white" : "bg-secondary"}`}
            >
              2 · Your work
            </span>
            <span
              className={`rounded-full px-3 py-2 ${step === 2 ? "bg-accent text-white" : "bg-secondary"}`}
            >
              3 · Review
            </span>
          </div>
          {error && (
            <div role="alert" className="mb-4">
              <Banner tone="bad">{error}</Banner>
            </div>
          )}
          {message && (
            <div className="mb-4">
              <Banner tone="good">{message}</Banner>
            </div>
          )}
          {step === 1 ? (
            <>
              <h2 className="mb-1 font-display text-2xl text-primary">What did you work on?</h2>
              <p className="mb-5 text-sm text-muted-foreground">
                Add time spent on each project. Leave out breaks and time you weren’t working.
              </p>
              <div className="space-y-4">
                {rows.map((r, index) => (
                  <Card key={r.key} className="p-5">
                    <div className="mb-4 flex items-center justify-between">
                      <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Work entry {index + 1}
                      </span>
                      {rows.length > 1 && (
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label={`Remove entry ${index + 1}`}
                          onClick={() => {
                            setRows((prev) => prev.filter((e) => e.key !== r.key));
                            setEdited(true);
                          }}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      )}
                    </div>
                    <Field label="Farm project">
                      <Select
                        className="h-12"
                        value={r.projectId}
                        onChange={(e) => update(r.key, { projectId: e.target.value })}
                      >
                        <option value="">Choose a project</option>
                        {options.map((p) => (
                          <option key={p.id} value={p.id}>
                            {projectLabel(p.name)} · {p.name}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <div className="my-4 grid grid-cols-2 gap-3">
                      <Field label="Hours">
                        <Input
                          className="h-12"
                          type="number"
                          inputMode="numeric"
                          min="0"
                          max="24"
                          placeholder="0"
                          value={r.hours}
                          onChange={(e) => update(r.key, { hours: e.target.value })}
                        />
                      </Field>
                      <Field label="Minutes">
                        <Input
                          className="h-12"
                          type="number"
                          inputMode="numeric"
                          min="0"
                          max="59"
                          placeholder="0"
                          value={r.minutes}
                          onChange={(e) => update(r.key, { minutes: e.target.value })}
                        />
                      </Field>
                    </div>
                    <Field label="What did you do?" hint="A short description is enough.">
                      <Textarea
                        rows={3}
                        maxLength={500}
                        placeholder="e.g. Harvested beetroot and watered seedlings"
                        value={r.description}
                        onChange={(e) => update(r.key, { description: e.target.value })}
                      />
                    </Field>
                  </Card>
                ))}
              </div>
              <Button
                size="lg"
                variant="outline"
                className="mt-4 w-full"
                disabled={rows.length >= 30}
                onClick={() => {
                  setRows((prev) => [...prev, blank()]);
                  setEdited(true);
                }}
              >
                <Plus /> Add another project
              </Button>
            </>
          ) : (
            <Card className="p-5">
              <h2 className="font-display text-2xl text-primary">Check your day</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Make sure the projects, time and descriptions are right.
              </p>
              {rows.map((r) => (
                <div key={r.key} className="mt-4 border-t border-border pt-4">
                  <div className="flex justify-between gap-3 font-semibold">
                    <span>
                      {projectLabel(options.find((p) => p.id === Number(r.projectId))?.name ?? "")}
                    </span>
                    <span className="shrink-0">
                      {timeLabel(Number(r.hours || 0) * 60 + Number(r.minutes || 0))}
                    </span>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                    {r.description}
                  </p>
                </div>
              ))}
            </Card>
          )}
          <div className="mt-5 rounded-lg bg-primary p-4 text-primary-foreground">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-sm">
                <Clock3 className="size-4" /> Daily total
              </span>
              <span className="font-display text-2xl">{timeLabel(total)}</span>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {step === 1 ? (
              <>
                <Button
                  size="lg"
                  variant="outline"
                  disabled={save.isPending}
                  onClick={() => void persist("draft")}
                >
                  {save.isPending ? "Saving…" : "Save draft"}
                </Button>
                <Button
                  size="lg"
                  onClick={() => {
                    const invalid = validate();
                    setError(invalid);
                    if (!invalid) setStep(2);
                  }}
                >
                  Review day <ArrowRight />
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="lg"
                  variant="outline"
                  disabled={save.isPending}
                  onClick={() => setStep(1)}
                >
                  <ArrowLeft /> Edit work
                </Button>
                <Button size="lg" disabled={save.isPending} onClick={() => void persist("submit")}>
                  {save.isPending ? "Submitting…" : "Submit day"} <Check />
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}

export default function TimeLog() {
  const clearManagerCache = useClearManagerCache();
  useEffect(() => {
    if (managerToken()) {
      const request = signOutManager();
      clearManagerCache();
      void request
        .catch(() => {})
        .finally(clearManagerCache);
    }
  }, [clearManagerCache]);
  const options = useTimeOptions();
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [date, setDate] = useState(farmToday());
  const [started, setStarted] = useState(false);
  const [chooseError, setChooseError] = useState("");
  const day = useTimeDay(employeeId, date);
  const range = weekRange(date);
  const history = useTimeHistory(employeeId, range.from, range.to);
  const employee = options.data?.employees.find((e) => e.id === employeeId);
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-primary text-primary-foreground">
        <div className="mx-auto flex max-w-2xl items-center justify-between px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Sprout className="size-6 text-accent" />
            <div>
              <div className="font-display text-lg">Favour Farm</div>
              <div className="text-xs text-white/60">Daily timesheets</div>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2 text-xs text-white/70">
            <Link to="/lists" className="hover:text-white">Weekly Lists</Link>
            <Link to="/timesheets" className="hover:text-white">Manager sign-in</Link>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-2xl px-5 py-7 pb-24">
        {options.isLoading ? (
          <Loading label="Loading employees" />
        ) : options.error ? (
          <Banner tone="bad">{errorMessage(options.error)}</Banner>
        ) : started && employee ? (
          day.isLoading ? (
            <Loading label="Loading your day" />
          ) : day.error ? (
            <Banner tone="bad">{errorMessage(day.error)}</Banner>
          ) : (
            <DayGuide
              key={`${employee.id}:${date}`}
              employee={employee}
              date={date}
              saved={day.data ?? null}
              projects={options.data?.projects ?? []}
              onExit={() => {
                setStarted(false);
                setEmployeeId(null);
                setDate(options.data?.today ?? farmToday());
                setChooseError("");
              }}
            />
          )
        ) : (
          <>
            <div className="mb-6">
              <div className="mb-2 text-xs font-semibold uppercase tracking-widest text-accent">
                Step 1 of 3 · Who & when
              </div>
              <h1 className="font-display text-3xl leading-tight text-primary">
                Let’s log your day.
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Choose your name, then tell us what you worked on.
              </p>
            </div>
            <Card className="p-5">
              <h2 className="mb-4 font-semibold text-primary">Who is logging time?</h2>
              <div className="grid grid-cols-2 gap-3">
                {options.data?.employees.map((e) => (
                  <button
                    type="button"
                    key={e.id}
                    onClick={() => setEmployeeId(e.id)}
                    className={`flex min-h-14 items-center gap-3 rounded-lg border p-3 text-left text-sm font-semibold transition-colors ${employeeId === e.id ? "border-primary bg-primary text-white" : "border-border bg-background hover:border-accent"}`}
                  >
                    <span
                      className={`flex size-8 items-center justify-center rounded-full ${employeeId === e.id ? "bg-white/15" : "bg-secondary text-primary"}`}
                    >
                      {e.name.charAt(0)}
                    </span>
                    {e.name}
                    {employeeId === e.id && <Check className="ml-auto size-4" />}
                  </button>
                ))}
              </div>
              {!options.data?.employees.length && (
                <p className="text-sm text-muted-foreground">
                  Ask the manager to add employees in timesheet setup.
                </p>
              )}
              <div className="mt-6">
                <Field label="Day worked">
                  <Input
                    type="date"
                    className="h-12"
                    max={options.data?.today ?? farmToday()}
                    value={date}
                    onChange={(e) => {
                      if (e.target.value) setDate(e.target.value);
                    }}
                  />
                </Field>
              </div>
              {chooseError && (
                <p role="alert" className="mt-3 text-sm text-destructive">
                  {chooseError}
                </p>
              )}
              <Button
                size="lg"
                className="mt-5 h-12 w-full"
                disabled={day.isFetching}
                onClick={() => {
                  if (!employeeId) {
                    setChooseError("Choose your name first.");
                    return;
                  }
                  setStarted(true);
                }}
              >
                Continue <ArrowRight />
              </Button>
            </Card>
            {employee && (
              <div className="mt-7">
                <h2 className="font-display text-xl text-primary">{employee.name}’s week</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {shortDate(range.from)} – {shortDate(range.to)} ·{" "}
                  {timeLabel((history.data ?? []).reduce((n, d) => n + d.totalMinutes, 0))} logged
                </p>
                {history.isLoading ? (
                  <Loading label="Loading this week" />
                ) : history.error ? (
                  <Banner tone="bad">{errorMessage(history.error)}</Banner>
                ) : !history.data?.length ? (
                  <p className="mt-3 text-sm text-muted-foreground">
                    No saved days for this week yet.
                  </p>
                ) : (
                  <div className="mt-3 space-y-2">
                    {history.data.map((d) => (
                      <button
                        type="button"
                        key={d.id}
                        onClick={() => {
                          setDate(d.date);
                          setStarted(true);
                        }}
                        className="flex w-full items-center justify-between gap-2 rounded-lg border border-border bg-card p-4 text-left"
                      >
                        <span>
                          <span className="block text-sm font-semibold">{shortDate(d.date)}</span>
                          <span className="text-xs text-muted-foreground">
                            {timeLabel(d.totalMinutes)} · {d.entries.length} work entries
                          </span>
                        </span>
                        <Chip
                          tone={
                            d.status === "approved"
                              ? "good"
                              : d.status === "returned"
                                ? "warn"
                                : "info"
                          }
                        >
                          {d.status}
                        </Chip>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <p className="mt-6 text-xs leading-relaxed text-muted-foreground">
              Shared farm device: names aren’t passwords. Check that you’ve selected your own name.
              Finish your day before handing the device to the next person.
            </p>
          </>
        )}
      </main>
    </div>
  );
}
