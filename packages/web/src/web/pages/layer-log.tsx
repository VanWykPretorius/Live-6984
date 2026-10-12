import { useEffect, useState } from "react";
import { Link } from "wouter";
import { ArrowRightLeft, Bird, Egg, PackageMinus, PackagePlus, Skull } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
import { Banner, Card, Chip, Loading } from "@/components/ui/misc";
import { useLayerLogOptions, useLogEggCollection, useLogLayerBirdEvent, useLogLayerFeed } from "@/queries/layers";
import { useClearManagerCache } from "@/queries/timesheets";
import { managerToken, signOutManager } from "@/lib/auth";
import { errorMessage, shortDate } from "@/lib/format";
import { farmToday } from "@/lib/timesheets";

type Employee = { id: number; name: string };
type Collection = {
  id: number;
  mobileId: number;
  collectionDate: string;
  laid: number;
  saleable: number;
  broken: number;
  actor: string;
};
type Mobile = {
  id: number;
  name: string;
  birdCount: number;
  todayCollection: Collection | null;
};
type EggStock = { id: number; eggsOnHand: number; revision: number };
type FeedType = { id: number; name: string; bagWeightKg: number; bagsOnHand: number; revision: number };
type Action = "eggs" | "feedOut" | "feedIn" | "arrival" | "death" | "move";

const num = (value: string | undefined) => Number(value || 0);

function ShellError({ error, message }: { error: string; message: string }) {
  return (
    <>
      {error && <div className="mt-4"><Banner tone="bad">{error}</Banner></div>}
      {message && <div className="mt-4"><Banner tone="good">{message}</Banner></div>}
    </>
  );
}

function MobileSelect({ mobiles, value, onChange, label = "Egg mobile" }: { mobiles: Mobile[]; value: string; onChange: (value: string) => void; label?: string }) {
  return (
    <Field label={label}>
      <Select className="h-12" value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose mobile</option>
        {mobiles.map((mobile) => <option key={mobile.id} value={mobile.id}>{mobile.name} · {mobile.birdCount} hens</option>)}
      </Select>
    </Field>
  );
}

function EggForm({ employee, mobiles, today }: { employee: Employee; mobiles: Mobile[]; today: string }) {
  const save = useLogEggCollection();
  const [mobileId, setMobileId] = useState("");
  const [collectionDate, setCollectionDate] = useState(today);
  const [laid, setLaid] = useState("");
  const [saleable, setSaleable] = useState("");
  const [broken, setBroken] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const mobile = mobiles.find((row) => row.id === Number(mobileId));
  const alreadyLogged = !!mobile?.todayCollection && collectionDate === today;
  const mismatch = num(laid) !== num(saleable) + num(broken);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    if (!mobile) return setError("Choose the egg mobile.");
    if (mismatch) return setError(`Eggs laid (${num(laid)}) must equal saleable + broken (${num(saleable) + num(broken)}).`);
    try {
      const result = await save.mutateAsync({
        employeeId: employee.id,
        mobileId: mobile.id,
        collectionDate,
        laid: num(laid),
        saleable: num(saleable),
        broken: num(broken),
        note,
      });
      setMessage(`${num(laid)} eggs logged for ${mobile.name} — ${num(saleable)} saleable into stock (${result.eggsOnHand} on hand now).`);
      setLaid("");
      setSaleable("");
      setBroken("");
      setNote("");
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <Card className="p-5">
      <h2 className="font-display text-2xl text-primary">Log the egg collection</h2>
      <p className="mt-1 text-sm text-muted-foreground">Count every egg in the mobile. Saleable eggs go into the egg stock that invoices deduct from.</p>
      <form onSubmit={(e) => void submit(e)} className="mt-4 space-y-4">
        <MobileSelect mobiles={mobiles} value={mobileId} onChange={setMobileId} />
        <Field label="Collection date"><Input type="date" className="h-12" max={today} value={collectionDate} onChange={(e) => setCollectionDate(e.target.value)} /></Field>
        {alreadyLogged && <Banner tone="warn">{mobile?.name} already has a collection for today — the manager must void it before you can log again.</Banner>}
        <div className="grid grid-cols-3 gap-3">
          <Field label="Eggs laid"><Input type="number" className="h-12" min="0" step="1" inputMode="numeric" value={laid} onChange={(e) => setLaid(e.target.value)} required /></Field>
          <Field label="Saleable"><Input type="number" className="h-12" min="0" step="1" inputMode="numeric" value={saleable} onChange={(e) => setSaleable(e.target.value)} required /></Field>
          <Field label="Broken"><Input type="number" className="h-12" min="0" step="1" inputMode="numeric" value={broken} onChange={(e) => setBroken(e.target.value)} required /></Field>
        </div>
        <Banner tone={mismatch ? "bad" : "good"}>Laid {num(laid)} = saleable {num(saleable)} + broken {num(broken)}{mismatch ? " — these must balance." : "."}</Banner>
        <Field label="Note · optional"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <Button size="lg" className="w-full" disabled={save.isPending || !mobile || mismatch || alreadyLogged}>{save.isPending ? "Saving…" : `Log ${num(laid) || ""} eggs`}</Button>
        <ShellError error={error} message={message} />
      </form>
    </Card>
  );
}

function FeedForm({ kind, employee, mobiles, feeds, today }: { kind: "feedOut" | "feedIn"; employee: Employee; mobiles: Mobile[]; feeds: FeedType[]; today: string }) {
  const save = useLogLayerFeed();
  const [feedTypeId, setFeedTypeId] = useState("");
  const [movementDate, setMovementDate] = useState(today);
  const [bags, setBags] = useState("");
  const [mobileId, setMobileId] = useState("");
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
        kind: kind === "feedIn" ? "delivery" : "withdrawal",
        bags: num(bags),
        mobileId: kind === "feedOut" && mobileId ? Number(mobileId) : null,
        note,
      });
      setMessage(`${num(bags)} bag${num(bags) === 1 ? "" : "s"} logged. ${result.bagsOnHand} bags remain.`);
      setBags("");
      setNote("");
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <Card className="p-5">
      <h2 className="font-display text-2xl text-primary">{kind === "feedIn" ? "Layer feed delivered into storage" : "Take layer feed to a mobile"}</h2>
      <form onSubmit={(e) => void submit(e)} className="mt-4 space-y-4">
        <Field label="Feed type"><Select className="h-12" value={feedTypeId} onChange={(e) => setFeedTypeId(e.target.value)}><option value="">Choose feed</option>{feeds.map((row) => <option key={row.id} value={row.id}>{row.name} · {row.bagWeightKg} kg · {row.bagsOnHand} bags left</option>)}</Select></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Date"><Input type="date" className="h-12" max={today} value={movementDate} onChange={(e) => setMovementDate(e.target.value)} /></Field><Field label="Whole bags"><Input type="number" className="h-12" min="1" step="1" inputMode="numeric" value={bags} onChange={(e) => setBags(e.target.value)} required /></Field></div>
        {kind === "feedOut" && <Field label="Mobile · optional"><Select className="h-12" value={mobileId} onChange={(e) => setMobileId(e.target.value)}><option value="">Shared / not sure</option>{mobiles.map((mobile) => <option key={mobile.id} value={mobile.id}>{mobile.name}</option>)}</Select></Field>}
        <Field label="Note · optional"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} /></Field>
        <Button size="lg" className="w-full" disabled={save.isPending || !feed}>{save.isPending ? "Saving…" : kind === "feedIn" ? "Log feed delivery" : "Log feed taken"}</Button>
        <ShellError error={error} message={message} />
      </form>
    </Card>
  );
}

function BirdForm({ kind, employee, mobiles, today }: { kind: "arrival" | "death" | "move"; employee: Employee; mobiles: Mobile[]; today: string }) {
  const save = useLogLayerBirdEvent();
  const [mobileId, setMobileId] = useState("");
  const [toMobileId, setToMobileId] = useState("");
  const [eventDate, setEventDate] = useState(today);
  const [count, setCount] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const mobile = mobiles.find((row) => row.id === Number(mobileId));
  const destinations = mobiles.filter((row) => row.id !== Number(mobileId));
  const headings = {
    arrival: "New hens arrive",
    death: "Log layer deaths",
    move: "Move hens between mobiles",
  } as const;
  const labels = { arrival: "Hens arrived", death: "Deaths", move: "Hens moved" } as const;
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setMessage("");
    if (!mobile) return setError("Choose the egg mobile.");
    if (kind === "move" && !toMobileId) return setError("Choose the mobile the hens move into.");
    try {
      await save.mutateAsync({
        employeeId: employee.id,
        kind,
        mobileId: mobile.id,
        toMobileId: kind === "move" ? Number(toMobileId) : null,
        eventDate,
        count: num(count),
        note,
      });
      setMessage(`${num(count)} hen${num(count) === 1 ? "" : "s"} logged for ${mobile.name}.`);
      setCount("");
      setNote("");
    } catch (err) {
      setError(errorMessage(err));
    }
  }
  return (
    <Card className="p-5">
      <h2 className="font-display text-2xl text-primary">{headings[kind]}</h2>
      <form onSubmit={(e) => void submit(e)} className="mt-4 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <MobileSelect mobiles={mobiles} value={mobileId} onChange={setMobileId} label={kind === "move" ? "From mobile" : "Egg mobile"} />
          <Field label="Date"><Input type="date" className="h-12" max={today} value={eventDate} onChange={(e) => setEventDate(e.target.value)} /></Field>
        </div>
        {kind === "move" && (
          <Field label="Into mobile">
            <Select className="h-12" value={toMobileId} onChange={(e) => setToMobileId(e.target.value)}>
              <option value="">Choose mobile</option>
              {destinations.map((row) => <option key={row.id} value={row.id}>{row.name} · {row.birdCount} hens</option>)}
            </Select>
          </Field>
        )}
        <Field label={labels[kind]}><Input type="number" className="h-12" min="1" step="1" inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value)} required /></Field>
        {kind !== "arrival" && mobile && num(count) > mobile.birdCount && <Banner tone="bad">Only {mobile.birdCount} hens are in {mobile.name}.</Banner>}
        <Field label="Note · optional"><Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === "arrival" ? "e.g. point-of-lay pullets" : ""} /></Field>
        <Button size="lg" className="w-full" disabled={save.isPending || !mobile || num(count) <= 0 || (kind === "move" && !toMobileId)}>{save.isPending ? "Saving…" : `Log ${num(count) || ""} hens`}</Button>
        <ShellError error={error} message={message} />
      </form>
    </Card>
  );
}

export default function LayerLog() {
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
  const options = useLayerLogOptions(signedOut);
  const [employeeId, setEmployeeId] = useState<number | null>(null);
  const [action, setAction] = useState<Action>("eggs");
  const employee = options.data?.employees.find((row) => row.id === employeeId) ?? null;
  const actions = [
    { id: "eggs" as const, label: "Log eggs", icon: Egg },
    { id: "feedOut" as const, label: "Feed out", icon: PackageMinus },
    { id: "feedIn" as const, label: "Feed in", icon: PackagePlus },
    { id: "arrival" as const, label: "Hens arrive", icon: Bird },
    { id: "death" as const, label: "Deaths", icon: Skull },
    { id: "move" as const, label: "Move hens", icon: ArrowRightLeft },
  ];
  const today = options.data?.today ?? farmToday();
  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-primary text-primary-foreground"><div className="mx-auto flex max-w-3xl items-center justify-between px-5 py-4"><div className="flex items-center gap-2.5"><Egg className="size-6 text-accent" /><div><div className="font-display text-lg">Pastured Layers</div><div className="text-xs text-white/60">Shared farm logging</div></div></div><div className="flex flex-col items-end gap-1 text-xs text-white/70"><Link to="/lists" className="hover:text-white">Weekly Lists</Link><Link to="/layers" className="hover:text-white">Manager sign-in</Link></div></div></header>
      <main className="mx-auto max-w-3xl px-5 py-7 pb-24">
        {options.isLoading ? <Loading label="Loading layer register" /> : options.error ? <Banner tone="bad">{errorMessage(options.error)}</Banner> : !employee ? (
          <><div className="mb-6"><div className="mb-2 text-xs font-semibold uppercase tracking-widest text-accent">Who is logging?</div><h1 className="font-display text-3xl text-primary">Layer work log</h1><p className="mt-2 text-sm text-muted-foreground">Choose your name, then record the egg collection or layer flock changes.</p></div><div className="grid grid-cols-2 gap-3">{options.data?.employees.map((row) => <button key={row.id} type="button" onClick={() => setEmployeeId(row.id)} className="flex min-h-14 items-center gap-3 rounded-lg border border-border bg-card p-3 text-left text-sm font-semibold hover:border-accent"><span className="flex size-8 items-center justify-center rounded-full bg-secondary text-primary">{row.name.charAt(0)}</span>{row.name}</button>)}</div>{!options.data?.employees.length && <div className="mt-4"><Banner tone="warn">Ask the manager to add employees in Timesheets setup.</Banner></div>}</>
        ) : (
          <><div className="mb-5 flex flex-wrap items-center justify-between gap-3"><div><h1 className="font-display text-3xl text-primary">{employee.name}</h1><p className="mt-1 text-sm text-muted-foreground">Today · {shortDate(today)}</p></div><Button variant="outline" onClick={() => setEmployeeId(null)}>Change name</Button></div><div className="mb-5 grid grid-cols-2 gap-2 sm:grid-cols-4">{actions.map((item) => <button key={item.id} type="button" onClick={() => setAction(item.id)} className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-lg border px-2 text-xs font-semibold ${action === item.id ? "border-accent bg-accent text-white" : "border-border bg-card text-primary"}`}><item.icon className="size-5" />{item.label}</button>)}</div><div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">{options.data?.mobiles.map((mobile) => <Card key={mobile.id} className="p-4"><div className="text-xs font-semibold uppercase text-muted-foreground">{mobile.name}</div><div className="mt-1 font-display text-2xl text-primary">{mobile.todayCollection ? mobile.todayCollection.laid : "—"}</div><div className="text-xs text-muted-foreground">{mobile.todayCollection ? `${mobile.todayCollection.saleable} saleable · ${mobile.todayCollection.broken} broken` : "not collected yet"}</div></Card>)}<Card className="p-4"><div className="text-xs font-semibold uppercase text-muted-foreground">Saleable stock</div><div className="mt-1 font-display text-2xl text-primary">{options.data?.eggStock.eggsOnHand ?? 0}</div><div className="text-xs text-muted-foreground">eggs ready to sell</div></Card></div>{action === "eggs" ? <EggForm employee={employee} mobiles={options.data?.mobiles ?? []} today={today} /> : action === "feedOut" || action === "feedIn" ? <FeedForm kind={action} employee={employee} mobiles={options.data?.mobiles ?? []} feeds={options.data?.feedTypes ?? []} today={today} /> : <BirdForm kind={action} employee={employee} mobiles={options.data?.mobiles ?? []} today={today} />}<div className="mt-6 flex flex-wrap gap-2">{options.data?.mobiles.map((mobile) => <Chip key={mobile.id}>{mobile.name}: {mobile.birdCount} hens</Chip>)}{options.data?.feedTypes.map((feed) => <Chip key={feed.id}>{feed.name}: {feed.bagsOnHand} bags</Chip>)}</div></>
        )}
      </main>
    </div>
  );
}
