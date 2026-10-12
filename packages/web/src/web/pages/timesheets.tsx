import { useState } from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  ArrowUpRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Download,
  LogOut,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/input";
import { Banner, Card, Chip, ConfirmButton, Loading, Modal, PageHeader, Stat } from "@/components/ui/misc";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/toast";
import {
  useDeleteTimesheetDay,
  useExportTimes,
  useManagerSession,
  useReviewList,
  useReviewTime,
  useSaveEmployee,
  useSaveProject,
  useSetManagerPassword,
  useTimeSetup,
} from "@/queries/timesheets";
import { authClient, signOutManager } from "@/lib/auth";
import { addDays, errorMessage, shortDate, weekRange } from "@/lib/format";
import { farmToday, projectLabel, timeLabel } from "@/lib/timesheets";

function ManagerLogin({ refresh }: { refresh: () => void }) {
  const [email, setEmail] = useState("vanwyk@favourfarm.co.za");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function google() {
    setError("");
    setBusy(true);
    try {
      const result = await authClient.managedAuth.signIn({ provider: "google" });
      if (result.error) throw new Error(result.error.message);
      refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function emailSignIn() {
    setError("");
    setBusy(true);
    try {
      authClient.managedAuth.clearToken();
      sessionStorage.removeItem("farm-manager-email-token");
      const result = await authClient.signIn.email({ email, password });
      if (result.error) throw new Error(result.error.message);
      setPassword("");
      refresh();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        title="Manager access"
        subtitle="Weekly Lists and employee timesheets are open to everyone. Sign in for invoicing, review and setup."
        actions={
          <Link to="/timesheets/log">
            <Button variant="outline">
              <ArrowUpRight /> Employee guide
            </Button>
          </Link>
        }
      />
      <Card className="mx-auto max-w-lg p-7">
        <ShieldCheck className="mb-4 size-8 text-accent" />
        <h2 className="font-display text-2xl text-primary">Manager sign-in</h2>
        <p className="mb-5 mt-2 text-sm text-muted-foreground">
          Private farm sections, review and setup are restricted to the verified account{" "}
          <strong>vanwyk@favourfarm.co.za</strong>.
        </p>
        <Button className="h-11 w-full" disabled={busy} onClick={() => void google()}>
          {busy ? "Signing in…" : "Continue with Google"}
        </Button>
        <p className="mt-2 text-xs text-muted-foreground">
          First visit? Sign in with Google to verify account ownership. You can then set an email
          sign-in password in Setup.
        </p>
        <div className="my-5 border-t border-border" />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void emailSignIn();
          }}
          className="space-y-3"
        >
          <Field label="Email">
            <Input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete="username"
            />
          </Field>
          <Field label="Password">
            <Input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
            />
          </Field>
          <Button variant="outline" className="w-full" disabled={busy} type="submit">
            Sign in with email
          </Button>
        </form>
        {error && (
          <div role="alert" className="mt-4">
            <Banner tone="bad">{error}</Banner>
          </div>
        )}
        <p className="mt-4 text-xs text-muted-foreground">
          Forgot your password? Use Google sign-in instead.
        </p>
      </Card>
    </>
  );
}

function Setup() {
  const setup = useTimeSetup();
  const saveEmployee = useSaveEmployee();
  const saveProject = useSaveProject();
  const setPassword = useSetManagerPassword();
  const toast = useToast();
  const [employeeName, setEmployeeName] = useState("");
  const [projectName, setProjectName] = useState("");
  const [password, updatePassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [editing, setEditing] = useState<{
    kind: "employee" | "project";
    id: number;
    name: string;
    active: boolean;
  } | null>(null);
  async function perform(task: () => Promise<unknown>, message: string) {
    try {
      await task();
      toast.push(message, "good");
    } catch (e) {
      toast.push(errorMessage(e), "bad");
    }
  }
  if (setup.isLoading) return <Loading label="Loading setup" />;
  if (setup.error) return <Banner tone="bad">{errorMessage(setup.error)}</Banner>;
  return (
    <>
      <div className="mb-4">
        <Banner>
          Projects use the exact Xero tracking-option names. These are maintained here; FarmBox does
          not sync the full list from Xero.
        </Banner>
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <h2 className="font-display text-xl text-primary">Employees</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Inactive employees disappear from the guide. Their history remains.
          </p>
          <div className="mt-4 space-y-2">
            {setup.data?.employees.map((e) => (
              <div
                key={e.id}
                className="flex items-center justify-between border-b border-border pb-2"
              >
                <span className="text-sm font-medium">
                  {e.name} {!e.active && <Chip>Inactive</Chip>}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing({ kind: "employee", ...e })}
                >
                  Edit
                </Button>
              </div>
            ))}
          </div>
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void perform(async () => {
                await saveEmployee.mutateAsync({ name: employeeName });
                setEmployeeName("");
              }, "Employee added.");
            }}
          >
            <Input
              aria-label="New employee name"
              placeholder="Employee name"
              value={employeeName}
              onChange={(e) => setEmployeeName(e.target.value)}
              required
            />
            <Button type="submit" disabled={saveEmployee.isPending || !employeeName.trim()}>
              <Plus /> Add
            </Button>
          </form>
        </Card>
        <Card className="p-5">
          <h2 className="font-display text-xl text-primary">Favour Projects</h2>
          <p className="mt-1 text-xs text-muted-foreground">
            Copy missing options exactly from Xero. Renaming does not rewrite past timesheets.
          </p>
          <div className="mt-4 space-y-2">
            {setup.data?.projects.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between border-b border-border pb-2"
              >
                <span className="font-mono text-xs">
                  {p.name} {!p.active && <Chip>Inactive</Chip>}
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setEditing({ kind: "project", ...p })}
                >
                  Edit
                </Button>
              </div>
            ))}
          </div>
          <form
            className="mt-4 flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              void perform(async () => {
                await saveProject.mutateAsync({ name: projectName });
                setProjectName("");
              }, "Project added.");
            }}
          >
            <Input
              aria-label="New Xero tracking option"
              placeholder="Exact Xero tracking option"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              required
            />
            <Button type="submit" disabled={saveProject.isPending || !projectName.trim()}>
              <Plus /> Add
            </Button>
          </form>
        </Card>
      </div>
      <Card className="mt-5 max-w-lg p-5">
        <h2 className="font-display text-xl text-primary">Enable email/password sign-in</h2>
        <p className="mb-4 mt-1 text-xs text-muted-foreground">
          Set a password after your first verified Google sign-in. For an existing password, keep
          using Google if you need to recover access.
        </p>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (password !== confirm) {
              toast.push("Passwords don’t match.", "bad");
              return;
            }
            void perform(async () => {
              await setPassword.mutateAsync({ password });
              updatePassword("");
              setConfirm("");
            }, "Password set. Email sign-in is now available.");
          }}
        >
          <Field label="New password · at least 12 characters">
            <Input
              type="password"
              autoComplete="new-password"
              minLength={12}
              maxLength={128}
              required
              value={password}
              onChange={(e) => updatePassword(e.target.value)}
            />
          </Field>
          <Field label="Confirm password">
            <Input
              type="password"
              autoComplete="new-password"
              required
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Field>
          <Button type="submit" disabled={setPassword.isPending}>
            {setPassword.isPending ? "Saving…" : "Set password"}
          </Button>
        </form>
      </Card>
      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title={`Edit ${editing?.kind ?? ""}`}
        footer={
          <Button
            disabled={saveEmployee.isPending || saveProject.isPending || !editing?.name.trim()}
            onClick={() =>
              void perform(async () => {
                if (!editing) return;
                const mutation = editing.kind === "employee" ? saveEmployee : saveProject;
                await mutation.mutateAsync({
                  id: editing.id,
                  name: editing.name,
                  active: editing.active,
                });
                setEditing(null);
              }, "Saved.")
            }
          >
            Save changes
          </Button>
        }
      >
        {editing && (
          <div className="space-y-4">
            <Field
              label={editing.kind === "project" ? "Exact Xero tracking option" : "Employee name"}
            >
              <Input
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                aria-label="Active"
                checked={editing.active}
                onChange={(e) => setEditing({ ...editing, active: e.target.checked })}
              />
              Active in employee guide
            </label>
          </div>
        )}
      </Modal>
    </>
  );
}

function ManagerWorkspace({ email, onLogout }: { email: string; onLogout: () => void }) {
  const toast = useToast();
  const [tab, setTab] = useState<"review" | "history" | "setup">("review");
  const [week, setWeek] = useState(weekRange(farmToday()).from);
  const range = { from: week, to: addDays(week, 6) };
  const reviewList = useReviewList(range.from, range.to);
  const review = useReviewTime();
  const deleteDay = useDeleteTimesheetDay();
  const exportTimes = useExportTimes();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const records = reviewList.data ?? [];
  const selected = records.find((r) => r.day.id === selectedId);
  const pending = records.filter((r) => r.day.status === "submitted");
  const approved = records.filter((r) => r.day.status === "approved");
  const returned = records.filter((r) => r.day.status === "returned");
  const display = tab === "review" ? pending : records;
  const employeeTotals = new Map<string, { total: number; approved: number }>();
  const projectTotals = new Map<string, number>();
  for (const r of records) {
    const total = employeeTotals.get(r.employee) ?? { total: 0, approved: 0 };
    total.total += r.day.totalMinutes;
    if (r.day.status === "approved") total.approved += r.day.totalMinutes;
    employeeTotals.set(r.employee, total);
    if (r.day.status === "approved")
      for (const e of r.day.entries)
        projectTotals.set(e.project, (projectTotals.get(e.project) ?? 0) + e.minutes);
  }
  async function deleteSelected() {
    if (!selected) return;
    try {
      await deleteDay.mutateAsync({ dayId: selected.day.id });
      setSelectedId(null);
      toast.push("Timesheet day deleted.", "good");
    } catch (error) {
      toast.push(errorMessage(error), "bad");
    }
  }
  async function decide(action: "approve" | "return") {
    if (!selected) return;
    try {
      await review.mutateAsync({
        dayId: selected.day.id,
        revision: selected.day.revision,
        action,
        note,
      });
      setSelectedId(null);
      setNote("");
      toast.push(
        action === "approve" ? "Day approved and locked." : "Returned to employee for correction.",
        "good",
      );
    } catch (e) {
      toast.push(errorMessage(e), "bad");
    }
  }
  return (
    <>
      <PageHeader
        title="Timesheets"
        subtitle="Review each day. Keep project time aligned with Favour Projects in Xero."
        actions={
          <Button variant="outline" onClick={onLogout}>
            <LogOut /> Sign out & open employee guide
          </Button>
        }
      />
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-1 rounded-lg bg-secondary p-1">
          {(["review", "history", "setup"] as const).map((t) => (
            <button
              type="button"
              key={t}
              onClick={() => setTab(t)}
              className={`rounded-md px-4 py-2 text-sm font-semibold ${tab === t ? "bg-card text-primary shadow-sm" : "text-muted-foreground"}`}
            >
              {t === "review" ? "Review queue" : t === "history" ? "Weekly history" : "Setup"}
            </button>
          ))}
        </div>
        <span className="text-xs text-muted-foreground">
          {email} · idle sign-out after 10 minutes
        </span>
      </div>
      {tab === "setup" ? (
        <Setup />
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Button
                size="icon"
                variant="outline"
                aria-label="Previous week"
                onClick={() => setWeek(addDays(week, -7))}
              >
                <ChevronLeft />
              </Button>
              <Field label="Week starting">
                <Input
                  aria-label="Week starting"
                  type="date"
                  value={week}
                  onChange={(e) => {
                    if (e.target.value) setWeek(e.target.value);
                  }}
                />
              </Field>
              <Button
                size="icon"
                variant="outline"
                aria-label="Next week"
                onClick={() => setWeek(addDays(week, 7))}
              >
                <ChevronRight />
              </Button>
              <span className="ml-2 text-xs text-muted-foreground">to {shortDate(range.to)}</span>
            </div>
            <Button
              variant="outline"
              disabled={exportTimes.isPending || records.length === 0}
              onClick={async () => {
                try {
                  await exportTimes.mutateAsync(range);
                  toast.push("Timesheet CSV downloaded — includes status for each line.", "good");
                } catch (e) {
                  toast.push(errorMessage(e), "bad");
                }
              }}
            >
              <Download />
              {exportTimes.isPending ? "Downloading…" : "Download CSV"}
            </Button>
          </div>
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Awaiting review"
              value={pending.length}
              tone="warn"
              hint="submitted days this week"
            />
            <Stat
              label="Approved time"
              value={timeLabel(approved.reduce((n, r) => n + r.day.totalMinutes, 0))}
              tone="good"
            />
            <Stat
              label="Returned days"
              value={returned.length}
              hint="employee corrections needed"
            />
            <Stat
              label="All logged time"
              value={timeLabel(records.reduce((n, r) => n + r.day.totalMinutes, 0))}
              hint="includes drafts and returned days"
            />
          </div>
          {reviewList.isLoading ? (
            <Loading label="Loading timesheets" />
          ) : reviewList.error ? (
            <Banner tone="bad">{errorMessage(reviewList.error)}</Banner>
          ) : (
            <>
              <Card className="overflow-hidden">
                <div className="border-b border-border px-4 py-3">
                  <h2 className="font-display text-lg text-primary">
                    {tab === "review" ? "Ready for your review" : "Daily records"}
                  </h2>
                </div>
                {!display.length ? (
                  <div className="p-8 text-center">
                    <Check className="mx-auto mb-3 size-6 text-leaf" />
                    <h3 className="font-display text-lg text-primary">
                      {tab === "review" ? "No days waiting for review" : "No time logged this week"}
                    </h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {tab === "review"
                        ? "Submitted days for the selected week will appear here."
                        : "Employees can start with the daily guide."}
                    </p>
                  </div>
                ) : (
                  <Table>
                    <THead>
                      <TH>Employee</TH>
                      <TH>Day</TH>
                      <TH>Projects</TH>
                      <TH>Status</TH>
                      <TH align="right">Time</TH>
                      <TH />
                    </THead>
                    <tbody>
                      {display.map(({ day, employee }) => (
                        <TR key={day.id}>
                          <TD className="font-semibold">{employee}</TD>
                          <TD>{shortDate(day.date)}</TD>
                          <TD>
                            {[...new Set(day.entries.map((e) => projectLabel(e.project)))].join(
                              ", ",
                            )}
                          </TD>
                          <TD>
                            <Chip
                              tone={
                                day.status === "approved"
                                  ? "good"
                                  : day.status === "returned"
                                    ? "warn"
                                    : "info"
                              }
                            >
                              {day.status}
                            </Chip>
                          </TD>
                          <TD align="right">{timeLabel(day.totalMinutes)}</TD>
                          <TD align="right">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setSelectedId(day.id);
                                setNote("");
                              }}
                            >
                              Open day
                            </Button>
                          </TD>
                        </TR>
                      ))}
                    </tbody>
                  </Table>
                )}
              </Card>
              {tab === "history" && (
                <div className="mt-5 grid gap-5 lg:grid-cols-2">
                  <Card className="p-5">
                    <h2 className="mb-4 font-display text-xl text-primary">Time by employee</h2>
                    <Table>
                      <THead>
                        <TH>Employee</TH>
                        <TH align="right">Logged</TH>
                        <TH align="right">Approved</TH>
                      </THead>
                      <tbody>
                        {[...employeeTotals.entries()].map(([name, t]) => (
                          <TR key={name}>
                            <TD>{name}</TD>
                            <TD align="right">{timeLabel(t.total)}</TD>
                            <TD align="right">{timeLabel(t.approved)}</TD>
                          </TR>
                        ))}
                      </tbody>
                    </Table>
                  </Card>
                  <Card className="p-5">
                    <h2 className="mb-4 font-display text-xl text-primary">
                      Approved time by project
                    </h2>
                    {!projectTotals.size ? (
                      <p className="text-sm text-muted-foreground">
                        No approved time in this week yet.
                      </p>
                    ) : (
                      <Table>
                        <THead>
                          <TH>Xero tracking option</TH>
                          <TH align="right">Time</TH>
                        </THead>
                        <tbody>
                          {[...projectTotals.entries()].map(([name, minutes]) => (
                            <TR key={name}>
                              <TD className="font-mono text-xs">{name}</TD>
                              <TD align="right">{timeLabel(minutes)}</TD>
                            </TR>
                          ))}
                        </tbody>
                      </Table>
                    )}
                  </Card>
                </div>
              )}
            </>
          )}
        </>
      )}
      <Modal
        open={!!selected}
        onClose={() => setSelectedId(null)}
        title={`${selected?.employee ?? ""} · ${shortDate(selected?.day.date)}`}
        subtitle={
          selected ? `${timeLabel(selected.day.totalMinutes)} · ${selected.day.status}` : ""
        }
        wide
        footer={
          selected && (
            <>
              <ConfirmButton
                title={`Delete ${selected.employee} · ${shortDate(selected.day.date)}`}
                confirmLabel="Delete"
                className="inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all outline-none border border-destructive/40 bg-transparent text-destructive hover:bg-destructive/10 h-9 px-4 disabled:opacity-50"
                onConfirm={() => void deleteSelected()}
              >
                <Trash2 className="size-4" /> Delete
              </ConfirmButton>
              <Button variant="outline" onClick={() => setSelectedId(null)}>
                Close
              </Button>
              {["submitted", "approved"].includes(selected.day.status) && (
                <Button
                  variant="outline"
                  disabled={review.isPending || !note.trim()}
                  onClick={() => void decide("return")}
                >
                  <RotateCcw /> Return for correction
                </Button>
              )}
              {selected.day.status === "submitted" && (
                <Button disabled={review.isPending} onClick={() => void decide("approve")}>
                  <Check />
                  {review.isPending ? "Saving…" : "Approve day"}
                </Button>
              )}
            </>
          )
        }
      >
        {selected && (
          <>
            <div className="space-y-4">
              {selected.day.entries.map((e, i) => (
                <div key={`${e.projectId}-${i}`} className="border-b border-border pb-3">
                  <div className="flex justify-between gap-3 font-semibold text-primary">
                    <span>{projectLabel(e.project)}</span>
                    <span>{timeLabel(e.minutes)}</span>
                  </div>
                  <div className="mt-1 font-mono text-xs text-muted-foreground">{e.project}</div>
                  <p className="mt-2 whitespace-pre-wrap text-sm">{e.description}</p>
                </div>
              ))}
            </div>
            {selected.day.returnNote && (
              <div className="mt-4">
                <Banner tone="warn">Return note: {selected.day.returnNote}</Banner>
              </div>
            )}
            {["submitted", "approved"].includes(selected.day.status) && (
              <div className="mt-4">
                <Field
                  label="Correction note"
                  hint="Required to return a day. The employee will see this note."
                >
                  <Textarea
                    value={note}
                    maxLength={500}
                    rows={2}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="What should be corrected?"
                  />
                </Field>
              </div>
            )}
            <details className="mt-5 text-xs text-muted-foreground">
              <summary className="cursor-pointer font-semibold">Review history</summary>
              <ol className="mt-3 space-y-2">
                {selected.day.audit.map((a, i) => (
                  <li key={`${a.at}-${i}`}>
                    {a.action} · {a.actor} · {new Date(a.at).toLocaleString("en-ZA")}
                    {a.note ? ` — ${a.note}` : ""}
                  </li>
                ))}
              </ol>
            </details>
          </>
        )}
      </Modal>
    </>
  );
}

export default function Timesheets() {
  const session = useManagerSession();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const toast = useToast();
  async function logout() {
    try {
      await signOutManager();
    } catch (e) {
      toast.push(errorMessage(e), "bad");
    } finally {
      await qc.cancelQueries();
      qc.clear();
      navigate("/timesheets/log");
    }
  }
  if (session.isLoading) return <Loading label="Checking manager access" />;
  if (!session.data || session.error)
    return (
      <>
        <ManagerLogin
          refresh={() => {
            void session.refetch();
          }}
        />
        {session.error && "code" in session.error && session.error.code === "FORBIDDEN" && (
          <div className="mx-auto mt-4 max-w-lg">
            <Banner tone="bad">This account is not the verified designated manager.</Banner>
            <Button
              className="mt-3"
              variant="outline"
              onClick={async () => {
                try {
                  await signOutManager();
                } finally {
                  await qc.cancelQueries();
                  qc.clear();
                }
              }}
            >
              Sign out of this account
            </Button>
          </div>
        )}
      </>
    );
  return <ManagerWorkspace email={session.data.email} onLogout={() => void logout()} />;
}
