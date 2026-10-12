import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Bird, Drumstick, Flame, FlameKindling, PackageMinus, PackagePlus, Sprout } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Banner, Card, Chip, Loading } from "@/components/ui/misc";
import {
  useBroilerLogOptions,
  useLogBroilerDeath,
  useLogBroilerFeed,
  useLogBroilerGas,
  useLogBroilerMove,
  useLogBroilerSlaughter,
} from "@/queries/broilers";
import { useClearManagerCache } from "@/queries/timesheets";
import { managerToken, signOutManager } from "@/lib/auth";
import { errorMessage, shortDate } from "@/lib/format";
import { farmToday } from "@/lib/timesheets";

type Employee = { id: number; name: string };
type Pen = { id: number; name: string; kind: string };
type BatchPen = { penId: number; name: string; kind: string; birdCount: number };
type Batch = { id: number; name: string; liveBirds: number; revision: number; pens: BatchPen[] };
type FeedType = { id: number; name: string; bagWeightKg: number; bagsOnHand: number; revision: number };
type StockProduct = { productId: number; kgPerUnit: number; unit: string; product: { sku: string; description: string } };
type Gas = { id: number; bottleSizeKg: number; bottlesOnHand: number; targetBottles: number; revision: number };
type Action = "delivery" | "feed" | "gasIn" | "gasOut" | "death" | "move" | "slaughter";

const num = (value: string | undefined) => Number(value || 0);
const positiveRows = <T extends { id: number }>(rows: T[], values: Record<number, string>) =>
  rows.map((row) => ({ penId: row.id, count: num(values[row.id]) })).filter((row) => row.count > 0);

function ShellError({ error, message }: { error: string; message: string }) {
  return (
    <>
      {error && <div className="mt-4"><Banner tone="bad">{error}</Banner></div>}
      {message && <div className="mt-4"><Banner tone="good">{message}</Banner></div>}
    </>
  );
}

function BatchSelect({ batches, value, onChange }: { batches: Batch[]; value: string; onChange: (value: string) => void }) {
  return (
    <Field label="Batch">
      <Select className="h-12" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose batch</option>
        {batches.map((batch) => <option key={batch.id} value={batch.id}>{batch.name} · {batch.liveBirds} live</option>)}
      </Select>
    </Field>
  );
}

function CountFields({ label, pens, values, setValues }: { label: string; pens: BatchPen[]; values: Record<number, string>; setValues: (values: Record<number, string>) => void }) {
  return (
    <Field label={label} hint="Enter 0 for pens not affected.">
      <div className="space-y-2 rounded-md border border-border bg-white p-3">
        {pens.map((pen) => (
          <label key={pen.penId} className="flex min-h-11 items-center justify-between gap-3">
            <span className="text-sm font-medium">{pen.name} <span className="text-xs text-muted-foreground">({pen.birdCount} now)</span></span>
            <Input type="number" min="0" inputMode="numeric" className="w-24 text-right" value={values[pen.penId] ?? ""} onChange={(e) => setValues({ ...values, [pen.penId]: e.target.value })} />
          </label>
        ))}
      </div>
    </Field>
  );
}

function FeedForm({ kind, employee, batches, pens, feeds, today }: { kind: "delivery" | "feed"; employee: Employee; batches: Batch[]; pens: Pen[]; feeds: FeedType[]; today: string }) {
  const save = useLogBroilerFeed();
  const [feedTypeId, setFeedTypeId] = useState("");
  const [movementDate, setMovementDate] = useState(today);
  const [bags, setBags] = useState("");
  const [batchId, setBatchId] = useState("");
  const [penId, setPenId] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const feed = feeds.find((row) => row.id === Number(feedTypeId));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    if (!feed) return setError("Choose the feed type.");
    try {
      const result = await save.mutateAsync({
        employeeId: employee.id,
        feedTypeId: feed.id,
        revision: feed.revision,
        movementDate,
        kind: kind === "delivery" ? "delivery" : "withdrawal",
        bags: Number(bags),
        batchId: kind === "feed" && batchId ? Number(batchId) : null,
        penId: kind === "feed" && penId ? Number(penId) : null,
        note,
      });
      setMessage(`${bags} bag${Number(bags) === 1 ? "" : "s"} logged. ${result.bagsOnHand} bags remain.`);
      setBags("");
      setNote("");
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <Card className="p-5">
      <h2 className="font-display text-2xl text-primary">{kind === "delivery" ? "Feed delivered into storage" : "Take feed out of storage"}</h2>
      <form onSubmit={(e) => void submit(e)} className="mt-4 space-y-4">
        <Field label="Feed type"><Select className="h-12" value={feedTypeId} onChange={(e) => setFeedTypeId(e.target.value)}><option value="">Choose feed</option>{feeds.map((row) => <option key={row.id} value={row.id}>{row.name} · {row.bagWeightKg} kg · {row.bagsOnHand} bags left</option>)}</Select></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Date"><Input type="date" className="h-12" max={today} value={movementDate} onChange={(e) => setMovementDate(e.target.value)} /></Field><Field label="Whole bags"><Input type="number" className="h-12" min="1" step="1" value={bags} onChange={(e) => setBags(e.target.value)} required /></Field></div>
        {kind === "feed" && <div className="grid gap-3 sm:grid-cols-2"><Field label="Batch · optional"><Select value={batchId} onChange={(e) => setBatchId(e.target.value)}><option value="">Shared / not sure</option>{batches.map((batch) => <option key={batch.id} value={batch.id}>{batch.name}</option>)}</Select></Field><Field label="Pen · optional"><Select value={penId} onChange={(e) => setPenId(e.target.value)}><option value="">Choose pen</option>{pens.map((pen) => <option key={pen.id} value={pen.id}>{pen.name}</option>)}</Select></Field></div>}
        <Field label="Note · optional"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <Button size="lg" className="w-full" disabled={save.isPending}>{save.isPending ? "Saving…" : kind === "delivery" ? "Log feed delivery" : "Log feed taken"}</Button>
        <ShellError error={error} message={message} />
      </form>
    </Card>
  );
}

function DeathForm({ employee, batches, today }: { employee: Employee; batches: Batch[]; today: string }) {
  const save = useLogBroilerDeath();
  const [batchId, setBatchId] = useState("");
  const [eventDate, setEventDate] = useState(today);
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [cause, setCause] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const batch = batches.find((row) => row.id === Number(batchId));
  const total = Object.values(counts).reduce((sum, value) => sum + num(value), 0);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    if (!batch) return setError("Choose the batch.");
    const allocations = batch.pens.map((pen) => ({ penId: pen.penId, count: num(counts[pen.penId]) })).filter((row) => row.count > 0);
    if (!allocations.length) return setError("Enter deaths for at least one pen.");
    try {
      const result = await save.mutateAsync({ employeeId: employee.id, batchId: batch.id, revision: batch.revision, eventDate, allocations, cause, note });
      setMessage(`${total} death${total === 1 ? "" : "s"} logged. ${result.liveBirds} birds remain.`);
      setCounts({});
      setCause("");
      setNote("");
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <Card className="p-5"><h2 className="font-display text-2xl text-primary">Log deaths</h2><form onSubmit={(e) => void submit(e)} className="mt-4 space-y-4"><BatchSelect batches={batches} value={batchId} onChange={(value) => { setBatchId(value); setCounts({}); }} /><Field label="Date"><Input type="date" className="h-12" max={today} value={eventDate} onChange={(e) => setEventDate(e.target.value)} /></Field>{batch && <CountFields label="Deaths by pen" pens={batch.pens} values={counts} setValues={setCounts} />}<Field label="Cause · optional"><Input placeholder="e.g. cold, predator, unknown" value={cause} onChange={(e) => setCause(e.target.value)} /></Field><Field label="Note · optional"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field><Button size="lg" className="w-full" disabled={save.isPending || !batch || total <= 0}>{save.isPending ? "Saving…" : `Log ${total || ""} deaths`}</Button><ShellError error={error} message={message} /></form></Card>
  );
}

function MoveForm({ employee, batches, pens, today }: { employee: Employee; batches: Batch[]; pens: Pen[]; today: string }) {
  const save = useLogBroilerMove();
  const [batchId, setBatchId] = useState("");
  const [fromPenId, setFromPenId] = useState("");
  const [eventDate, setEventDate] = useState(today);
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const batch = batches.find((row) => row.id === Number(batchId));
  const brooders = batch?.pens.filter((pen) => pen.kind === "brooder") ?? [];
  const source = brooders.find((pen) => pen.penId === Number(fromPenId));
  const otherBrooders = pens.filter((pen) => pen.kind === "brooder" && pen.id !== source?.penId);
  const pasturePens = pens.filter((pen) => pen.kind === "pasture");
  const destinations = [...otherBrooders, ...pasturePens];
  const total = Object.values(counts).reduce((sum, value) => sum + num(value), 0);
  const adjustment = total - (source?.birdCount ?? 0);
  const usedKinds = new Set(
    destinations.filter((pen) => num(counts[pen.id]) > 0).map((pen) => pen.kind),
  );
  const mixedKinds = usedKinds.size > 1;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    if (!batch || !source) return setError("Choose the batch and brooder pen.");
    if (mixedKinds) return setError("Move into brooder pens or pasture pens in one entry, not both.");
    const destinationCounts = positiveRows(destinations, counts);
    if (!destinationCounts.length) return setError("Enter counted birds for at least one destination pen.");
    if (adjustment !== 0 && !reason.trim()) return setError("The count changed. Add the adjustment reason.");
    try {
      const result = await save.mutateAsync({ employeeId: employee.id, batchId: batch.id, revision: batch.revision, eventDate, fromPenId: source.penId, destinations: destinationCounts, reason, note });
      setMessage(`${result.counted} birds moved. Recount adjustment: ${result.adjustment}.`);
      setCounts({});
      setReason("");
      setNote("");
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <Card className="p-5"><h2 className="font-display text-2xl text-primary">Move birds between pens</h2><p className="mt-1 text-sm text-muted-foreground">Count the birds again as they are moved. A batch can split across pens — between brooders, or out to pasture at about 3 weeks.</p><form onSubmit={(e) => void submit(e)} className="mt-4 space-y-4"><BatchSelect batches={batches} value={batchId} onChange={(value) => { setBatchId(value); setFromPenId(""); setCounts({}); }} /><Field label="From brooder"><Select className="h-12" value={fromPenId} onChange={(e) => { setFromPenId(e.target.value); setCounts({}); }}><option value="">Choose brooder</option>{brooders.map((pen) => <option key={pen.penId} value={pen.penId}>{pen.name} · expected {pen.birdCount}</option>)}</Select></Field><Field label="Move date"><Input type="date" className="h-12" max={today} value={eventDate} onChange={(e) => setEventDate(e.target.value)} /></Field>{source && <Field label="Counted birds into destination pens" hint="Fill either brooder pens or pasture pens, not both. Use two pens when a batch is split."><div className="rounded-md border border-border bg-white p-3"><div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Brooder pens</div><div className="grid grid-cols-2 gap-2">{otherBrooders.map((pen) => <label key={pen.id} className="flex min-h-11 items-center justify-between gap-2"><span className="text-sm font-medium">{pen.name}</span><Input type="number" min="0" className="w-20 text-right" value={counts[pen.id] ?? ""} onChange={(e) => setCounts({ ...counts, [pen.id]: e.target.value })} /></label>)}</div><div className="mb-1 mt-3 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Pasture pens</div><div className="grid grid-cols-2 gap-2">{pasturePens.map((pen) => <label key={pen.id} className="flex min-h-11 items-center justify-between gap-2"><span className="text-sm font-medium">{pen.name}</span><Input type="number" min="0" className="w-20 text-right" value={counts[pen.id] ?? ""} onChange={(e) => setCounts({ ...counts, [pen.id]: e.target.value })} /></label>)}</div></div></Field>}{mixedKinds && <Banner tone="bad">Move into brooder pens or pasture pens in one entry, not both.</Banner>}{source && !mixedKinds && <Banner tone={adjustment === 0 ? "good" : "warn"}>Expected {source.birdCount}; counted {total}; adjustment {adjustment}.</Banner>}{adjustment !== 0 && !mixedKinds && <Field label="Adjustment reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} required /></Field>}<Field label="Note · optional"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field><Button size="lg" className="w-full" disabled={save.isPending || !batch || !source || total <= 0 || mixedKinds}>{save.isPending ? "Saving…" : `Move ${total || ""} birds`}</Button><ShellError error={error} message={message} /></form></Card>
  );
}

function GasForm({ kind, employee, batches, pens, gas, today }: { kind: "gasIn" | "gasOut"; employee: Employee; batches: Batch[]; pens: Pen[]; gas: Gas; today: string }) {
  const save = useLogBroilerGas();
  const [movementDate, setMovementDate] = useState(today);
  const [bottles, setBottles] = useState("");
  const [batchId, setBatchId] = useState("");
  const [penId, setPenId] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const brooders = pens.filter((pen) => pen.kind === "brooder");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    try {
      const result = await save.mutateAsync({
        employeeId: employee.id,
        revision: gas.revision,
        movementDate,
        kind: kind === "gasIn" ? "delivery" : "withdrawal",
        bottles: Number(bottles),
        batchId: kind === "gasOut" && batchId ? Number(batchId) : null,
        penId: kind === "gasOut" && penId ? Number(penId) : null,
        note,
      });
      setMessage(`${bottles} bottle${Number(bottles) === 1 ? "" : "s"} logged. ${result.bottlesOnHand} in storage.`);
      setBottles("");
      setNote("");
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <Card className="p-5">
      <h2 className="font-display text-2xl text-primary">{kind === "gasIn" ? "Gas bottles delivered" : "Take a gas bottle to the brooder"}</h2>
      <p className="mt-1 text-sm text-muted-foreground">{gas.bottleSizeKg} kg bottles · {gas.bottlesOnHand} in storage · target {gas.targetBottles}</p>
      <form onSubmit={(e) => void submit(e)} className="mt-4 space-y-4">
        <div className="grid grid-cols-2 gap-3"><Field label="Date"><Input type="date" className="h-12" max={today} value={movementDate} onChange={(e) => setMovementDate(e.target.value)} /></Field><Field label="Bottles"><Input type="number" className="h-12" min="1" step="1" value={bottles} onChange={(e) => setBottles(e.target.value)} required /></Field></div>
        {kind === "gasOut" && <div className="grid gap-3 sm:grid-cols-2"><Field label="Batch · optional"><Select value={batchId} onChange={(e) => setBatchId(e.target.value)}><option value="">Shared / not sure</option>{batches.map((batch) => <option key={batch.id} value={batch.id}>{batch.name}</option>)}</Select></Field><Field label="Brooder · optional"><Select value={penId} onChange={(e) => setPenId(e.target.value)}><option value="">Choose brooder</option>{brooders.map((pen) => <option key={pen.id} value={pen.id}>{pen.name}</option>)}</Select></Field></div>}
        <Field label="Note · optional"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === "gasIn" ? "e.g. swapped 2 empties for full bottles" : ""} /></Field>
        <Button size="lg" className="w-full" disabled={save.isPending}>{save.isPending ? "Saving…" : kind === "gasIn" ? "Log gas delivery" : "Log gas taken"}</Button>
        <ShellError error={error} message={message} />
      </form>
    </Card>
  );
}

function SlaughterForm({ employee, batches, products, today }: { employee: Employee; batches: Batch[]; products: StockProduct[]; today: string }) {
  const save = useLogBroilerSlaughter();
  const [batchId, setBatchId] = useState("");
  const [eventDate, setEventDate] = useState(today);
  const [counts, setCounts] = useState<Record<number, string>>({});
  const [weights, setWeights] = useState<Record<number, string>>({});
  const [totalDressed, setTotalDressed] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const batch = batches.find((row) => row.id === Number(batchId));
  const pasture = batch?.pens.filter((pen) => pen.kind === "pasture") ?? [];
  const count = Object.values(counts).reduce((sum, value) => sum + num(value), 0);
  const productWeight = products.reduce((sum, row) => {
    const entered = num(weights[row.productId]);
    return sum + (row.unit === "bags" ? entered * row.kgPerUnit : entered);
  }, 0);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    if (!batch) return setError("Choose the batch.");
    const allocations = pasture.map((pen) => ({ penId: pen.penId, count: num(counts[pen.penId]) })).filter((row) => row.count > 0);
    const outputs = products
      .map((row) => row.unit === "bags"
        ? { productId: row.productId, weightKg: 0, bags: num(weights[row.productId]) }
        : { productId: row.productId, weightKg: num(weights[row.productId]) })
      .filter((row) => ("bags" in row ? row.bags : row.weightKg) > 0);
    if (!allocations.length) return setError("Enter how many chickens came from each pasture pen.");
    if (!outputs.length) return setError("Enter at least one product weight.");
    try {
      const result = await save.mutateAsync({ employeeId: employee.id, batchId: batch.id, revision: batch.revision, eventDate, allocations, totalDressedWeightKg: Number(totalDressed), outputs, note });
      setMessage(`${result.slaughtered} chickens logged. ${result.liveBirds} birds remain; products added to stock.`);
      setCounts({});
      setWeights({});
      setTotalDressed("");
      setNote("");
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <Card className="p-5"><h2 className="font-display text-2xl text-primary">Log slaughter</h2><form onSubmit={(e) => void submit(e)} className="mt-4 space-y-4"><div className="grid gap-3 sm:grid-cols-2"><BatchSelect batches={batches} value={batchId} onChange={(value) => { setBatchId(value); setCounts({}); }} /><Field label="Slaughter date"><Input type="date" className="h-12" max={today} value={eventDate} onChange={(e) => setEventDate(e.target.value)} /></Field></div>{batch && (pasture.length ? <CountFields label="Chickens slaughtered by pasture pen" pens={pasture} values={counts} setValues={setCounts} /> : <Banner tone="warn">This batch has no birds in pasture pens yet.</Banner>)}<Field label="Total dressed carcass weight · kg"><Input type="number" min="0" step="0.001" className="h-12" value={totalDressed} onChange={(e) => setTotalDressed(e.target.value)} required /></Field><Field label="Products made" hint="Kg for weighed products, number of bags for bagged ones. Leave products not produced at 0."><div className="max-h-96 space-y-2 overflow-y-auto rounded-md border border-border bg-white p-3">{products.map((row) => <label key={row.productId} className="grid min-h-11 grid-cols-[1fr_90px] items-center gap-3"><span><span className="block text-sm font-medium">{row.product.description}</span><span className="font-mono text-[10px] text-muted-foreground">{row.product.sku}{row.unit === "bags" ? ` · bags of ${row.kgPerUnit * 1000}g` : ""}</span></span><Input type="number" min="0" step={row.unit === "bags" ? "1" : "0.001"} className="text-right" placeholder={row.unit === "bags" ? "bags" : "kg"} value={weights[row.productId] ?? ""} onChange={(e) => setWeights({ ...weights, [row.productId]: e.target.value })} /></label>)}</div></Field><Banner tone={productWeight <= Number(totalDressed || 0) ? "info" : "bad"}>Products total {productWeight.toFixed(3)} kg; dressed weight {Number(totalDressed || 0).toFixed(3)} kg.</Banner><Field label="Note · optional"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field><Button size="lg" className="w-full" disabled={save.isPending || !batch || count <= 0}>{save.isPending ? "Saving…" : `Log ${count || ""} slaughtered`}</Button><ShellError error={error} message={message} /></form></Card>
  );
}

export default function BroilerLog() {
  const clearManagerCache = useClearManagerCache();
  // The shared phone must not stay signed in as the manager. Sign out first and only
  // then start the public queries, or the cache clear would cancel them mid-flight.
  const [signedOut, setSignedOut] = useState(() => !managerToken());
  useEffect(() => {
    if (signedOut) return;
    const request = signOutManager();
    void request
      .catch(() => {})
      .finally(() => {
        clearManagerCache();
        setSignedOut(true);
      });
  }, [signedOut, clearManagerCache]);
  const options = useBroilerLogOptions(signedOut);
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [action, setAction] = useState<Action>("feed");
  const employee = options.data?.employees.find((row) => row.id === employeeId) ?? null;
  const actions = [
    { id: "feed" as const, label: "Feed out", icon: PackageMinus },
    { id: "delivery" as const, label: "Feed in", icon: PackagePlus },
    { id: "gasOut" as const, label: "Gas out", icon: Flame },
    { id: "gasIn" as const, label: "Gas in", icon: FlameKindling },
    { id: "death" as const, label: "Deaths", icon: Bird },
    { id: "move" as const, label: "Move pens", icon: Sprout },
    { id: "slaughter" as const, label: "Slaughter", icon: Drumstick },
  ];
  const today = options.data?.today ?? farmToday();
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-primary text-primary-foreground"><div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4"><div className="flex items-center gap-2.5"><Drumstick className="size-6 text-accent" /><div><div className="font-display text-lg">Pastured Broilers</div><div className="text-xs text-white/60">Shared farm logging</div></div></div><div className="flex flex-col items-end gap-1 text-xs text-white/70"><Link to="/lists" className="hover:text-white">Weekly Lists</Link><Link to="/broilers" className="hover:text-white">Manager sign-in</Link></div></div></header>
      <main className="mx-auto max-w-3xl px-5 py-7 pb-24">
        {options.isLoading ? <Loading label="Loading broiler register" /> : options.error ? <Banner tone="bad">{errorMessage(options.error)}</Banner> : !employee ? (
          <><div className="mb-6"><div className="mb-2 text-xs font-semibold uppercase tracking-widest text-accent">Who is logging?</div><h1 className="font-display text-3xl text-primary">Broiler work log</h1><p className="mt-2 text-sm text-muted-foreground">Choose your name, then record feed, gas, deaths, pen moves or slaughter.</p></div><div className="grid grid-cols-2 gap-3">{options.data?.employees.map((row) => <button key={row.id} type="button" onClick={() => setEmployeeId(row.id)} className="flex min-h-14 items-center gap-3 rounded-lg border border-border bg-card p-3 text-left text-sm font-semibold hover:border-accent"><span className="flex size-8 items-center justify-center rounded-full bg-secondary text-primary">{row.name.charAt(0)}</span>{row.name}</button>)}</div>{!options.data?.employees.length && <div className="mt-4"><Banner tone="warn">Ask the manager to add employees in Timesheets setup.</Banner></div>}</>
        ) : (
          <><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h1 className="font-display text-3xl text-primary">{employee.name}</h1><p className="mt-1 text-sm text-muted-foreground">Today · {shortDate(today)}</p></div><Button variant="outline" onClick={() => setEmployeeId(null)}>Change name</Button></div><div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">{actions.map((item) => <button key={item.id} type="button" onClick={() => setAction(item.id)} className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg border px-2 text-xs font-semibold ${action === item.id ? "border-accent bg-accent text-white" : "border-border bg-card text-primary"}`}><item.icon className="size-5" />{item.label}</button>)}</div><div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3">{options.data?.feedTypes.map((feed) => <Card key={feed.id} className="p-4"><div className="text-xs font-semibold uppercase text-muted-foreground">{feed.name}</div><div className="mt-1 font-display text-2xl text-primary">{feed.bagsOnHand} bags</div><div className="text-xs text-muted-foreground">{feed.bagWeightKg} kg each</div></Card>)}{options.data?.gas && <Card className="p-4"><div className="text-xs font-semibold uppercase text-muted-foreground">Gas bottles</div><div className="mt-1 font-display text-2xl text-primary">{options.data.gas.bottlesOnHand}</div><div className="text-xs text-muted-foreground">{options.data.gas.bottleSizeKg} kg each · target {options.data.gas.targetBottles}</div></Card>}</div>{options.data?.gas && options.data.gas.bottlesOnHand < options.data.gas.targetBottles && <div className="mb-4"><Banner tone="warn">Only {options.data.gas.bottlesOnHand} gas bottle{options.data.gas.bottlesOnHand === 1 ? "" : "s"} left — tell the manager to order gas.</Banner></div>}{!options.data?.batches.length && action !== "delivery" && action !== "feed" && action !== "gasIn" && action !== "gasOut" && <div className="mb-4"><Banner tone="warn">No active broiler batch is available. The manager must confirm a chick arrival first.</Banner></div>}{action === "delivery" || action === "feed" ? <FeedForm kind={action} employee={employee} batches={options.data?.batches ?? []} pens={options.data?.pens ?? []} feeds={options.data?.feedTypes ?? []} today={today} /> : action === "gasIn" || action === "gasOut" ? (options.data?.gas ? <GasForm kind={action} employee={employee} batches={options.data?.batches ?? []} pens={options.data?.pens ?? []} gas={options.data.gas} today={today} /> : null) : action === "death" ? <DeathForm employee={employee} batches={options.data?.batches ?? []} today={today} /> : action === "move" ? <MoveForm employee={employee} batches={options.data?.batches ?? []} pens={options.data?.pens ?? []} today={today} /> : <SlaughterForm employee={employee} batches={options.data?.batches ?? []} products={options.data?.stockProducts ?? []} today={today} />}<div className="mt-6 flex flex-wrap gap-2">{options.data?.batches.map((batch) => <Chip key={batch.id}>{batch.name}: {batch.liveBirds} live</Chip>)}</div></>
        )}
      </main>
    </div>
  );
}
