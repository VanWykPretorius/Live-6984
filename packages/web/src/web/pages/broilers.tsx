import { useMemo, useState } from "react";
import { Link } from "wouter";
import { ArrowUpRight, Check, Drumstick, Package, Plus, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Banner, Card, Chip, ConfirmButton, Empty, Loading, Modal, Money, PageHeader, Stat } from "@/components/ui/misc";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/toast";
import {
  useAdjustBroilerStock,
  useApplyBroilerRunStock,
  useBroilerOverview,
  useBroilerRunStockPreview,
  useConfirmBroilerArrival,
  useCreateBroilerBatch,
  useReverseBroilerRunStock,
  useSaveBroilerFeedType,
  useSaveBroilerGasSettings,
  useSaveBroilerPen,
  useSaveBroilerStockProduct,
  useVoidBroilerEvent,
  useVoidBroilerFeedMovement,
  useVoidBroilerGasMovement,
} from "@/queries/broilers";
import { errorMessage, shortDate } from "@/lib/format";

type Overview = NonNullable<ReturnType<typeof useBroilerOverview>["data"]>;
type Batch = Overview["batches"][number];
type Run = Overview["salesRuns"][number];

function PlanCard({ today }: { today: string }) {
  const create = useCreateBroilerBatch();
  const toast = useToast();
  const [name, setName] = useState("");
  const [plannedDate, setPlannedDate] = useState(today);
  const [plannedCount, setPlannedCount] = useState("");
  const [supplier, setSupplier] = useState("");
  const [chickCost, setChickCost] = useState("");
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    try {
      await create.mutateAsync({ name, plannedDate, plannedCount: Number(plannedCount), supplier, chickCost: chickCost ? Number(chickCost) : null });
      setName("");
      setPlannedCount("");
      setSupplier("");
      setChickCost("");
      toast.push("Planned chick arrival added.", "good");
    } catch (error) {
      toast.push(errorMessage(error), "bad");
    }
  }
  return (
    <Card className="p-5">
      <h2 className="font-display text-xl text-primary">Plan day-old chicks</h2>
      <p className="mt-1 text-xs text-muted-foreground">Planned birds stay outside live balances until arrival is confirmed.</p>
      <form onSubmit={(e) => void submit(e)} className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Batch name · optional"><Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`Broilers ${plannedDate}`} /></Field>
        <Field label="Expected date"><Input type="date" value={plannedDate} onChange={(e) => setPlannedDate(e.target.value)} required /></Field>
        <Field label="Expected chicks"><Input type="number" min="1" step="1" value={plannedCount} onChange={(e) => setPlannedCount(e.target.value)} required /></Field>
        <Field label="Supplier · optional"><Input value={supplier} onChange={(e) => setSupplier(e.target.value)} /></Field>
        <Field label="Total chick cost · optional"><Input type="number" min="0" step="0.01" value={chickCost} onChange={(e) => setChickCost(e.target.value)} /></Field>
        <div className="flex items-end"><Button className="w-full" disabled={create.isPending}><Plus />{create.isPending ? "Adding…" : "Plan batch"}</Button></div>
      </form>
    </Card>
  );
}

function ArrivalCard({ data }: { data: Overview }) {
  const confirm = useConfirmBroilerArrival();
  const toast = useToast();
  const planned = data.batches.filter((batch) => batch.status === "planned");
  const brooders = data.pens.filter((pen) => pen.kind === "brooder" && pen.active);
  const [batchId, setBatchId] = useState("");
  const [actualDate, setActualDate] = useState(data.today);
  const [receivedCount, setReceivedCount] = useState("");
  const [deadOnArrival, setDeadOnArrival] = useState("0");
  const [arrivalPenId, setArrivalPenId] = useState("");
  const batch = planned.find((row) => row.id === Number(batchId));
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!batch) return;
    try {
      await confirm.mutateAsync({ batchId: batch.id, revision: batch.revision, actualDate, receivedCount: Number(receivedCount), deadOnArrival: Number(deadOnArrival || 0), arrivalPenId: Number(arrivalPenId) });
      toast.push("Arrival confirmed and brooder balance updated.", "good");
      setBatchId("");
      setReceivedCount("");
      setDeadOnArrival("0");
    } catch (error) {
      toast.push(errorMessage(error), "bad");
    }
  }
  return (
    <Card className="p-5">
      <h2 className="font-display text-xl text-primary">Confirm chicks received</h2>
      <form onSubmit={(e) => void submit(e)} className="mt-4 grid gap-3 sm:grid-cols-2">
        <Field label="Planned batch"><Select value={batchId} onChange={(e) => { setBatchId(e.target.value); const next = planned.find((row) => row.id === Number(e.target.value)); setReceivedCount(next ? String(next.plannedCount) : ""); }} required><option value="">Choose batch</option>{planned.map((row) => <option key={row.id} value={row.id}>{row.name} · {row.plannedCount}</option>)}</Select></Field>
        <Field label="Received date"><Input type="date" max={data.today} value={actualDate} onChange={(e) => setActualDate(e.target.value)} required /></Field>
        <Field label="Chicks received"><Input type="number" min="1" step="1" value={receivedCount} onChange={(e) => setReceivedCount(e.target.value)} required /></Field>
        <Field label="Dead on arrival"><Input type="number" min="0" step="1" value={deadOnArrival} onChange={(e) => setDeadOnArrival(e.target.value)} /></Field>
        <Field label="Brooder pen"><Select value={arrivalPenId} onChange={(e) => setArrivalPenId(e.target.value)} required><option value="">Choose brooder</option>{brooders.map((pen) => <option key={pen.id} value={pen.id}>{pen.name}</option>)}</Select></Field>
        <div className="flex items-end"><Button className="w-full" disabled={confirm.isPending || !batch}><Check />{confirm.isPending ? "Confirming…" : "Confirm arrival"}</Button></div>
      </form>
    </Card>
  );
}

function BatchDetail({ batch, events, stockProducts }: { batch: Batch; events: Overview["events"]; stockProducts: Overview["stockProducts"] }) {
  const voidEvent = useVoidBroilerEvent();
  const toast = useToast();
  const [reason, setReason] = useState("");
  const rows = events.filter((event) => event.batchId === batch.id);
  const bagWeightBySku = new Map(stockProducts.filter((row) => row.unit === "bags").map((row) => [row.product.sku, row.kgPerUnit]));
  async function voidRow(id: number) {
    if (reason.trim().length < 3) return toast.push("Enter a correction reason first.", "bad");
    try {
      await voidEvent.mutateAsync({ eventId: id, reason });
      setReason("");
      toast.push("Entry voided and balances reversed.", "good");
    } catch (error) {
      toast.push(errorMessage(error), "bad");
    }
  }
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border px-4 py-3">
        <div className="flex flex-wrap items-center justify-between gap-2"><div><div className="font-display text-lg font-semibold text-primary">{batch.name}</div><div className="text-xs text-muted-foreground">{batch.supplier || "No supplier"}{batch.chickCost ? " · " : ""}{batch.chickCost ? <Money value={batch.chickCost} /> : ""}</div></div><Chip tone={batch.status === "active" ? "good" : batch.status === "planned" ? "info" : "neutral"}>{batch.status}</Chip></div>
        <div className="mt-3 flex flex-wrap gap-2">{batch.pens.map((pen) => <Chip key={pen.id}>{pen.name}: {pen.birdCount}</Chip>)}</div>
      </div>
      <div className="border-b border-border px-4 py-3"><Field label="Correction reason for voiding an entry"><Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why is this entry wrong?" /></Field></div>
      <Table>
        <THead><TH>Date</TH><TH>Entry</TH><TH>By</TH><TH align="right">Birds</TH><TH>Details</TH><TH /></THead>
        <tbody>
          {rows.map((event) => (
            <TR key={event.id} className={event.voidedAt ? "opacity-50" : ""}>
              <TD>{shortDate(event.eventDate)}</TD>
              <TD><Chip tone={event.type === "death" ? "bad" : event.type === "slaughter" ? "warn" : "info"}>{event.type}</Chip>{event.voidedAt && <Chip>voided</Chip>}</TD>
              <TD>{event.employeeName ?? event.actor}</TD>
              <TD align="right">{event.totalCount}</TD>
              <TD className="max-w-md"><div className="text-xs">{event.allocations.map((a) => `${a.penName} ${a.role === "destination" ? "+" : a.role === "arrival" ? "+" : "−"}${a.birdCount}`).join(" · ")}</div>{event.reason && <div className="mt-1 text-xs text-warning">{event.reason}</div>}{event.note && <div className="mt-1 text-xs text-muted-foreground">{event.note}</div>}{event.slaughter && <div className="mt-1 text-xs">{event.slaughter.totalDressedWeightKg} kg dressed · {event.outputs.map((o) => { const bag = bagWeightBySku.get(o.sku); return bag ? `${o.sku} ${Math.round(o.weightKg / bag)} bags` : `${o.sku} ${o.weightKg}kg`; }).join(", ")}</div>}{event.voidReason && <div className="mt-1 text-xs text-destructive">Voided: {event.voidReason}</div>}</TD>
              <TD align="right">{!event.voidedAt && <ConfirmButton title="Void entry" confirmLabel="Void" className="text-xs font-semibold text-destructive" onConfirm={() => voidRow(event.id)}><RotateCcw className="inline size-3" /> Void</ConfirmButton>}</TD>
            </TR>
          ))}
          {!rows.length && <TR><TD colSpan={6}><Empty title="No events yet" /></TD></TR>}
        </tbody>
      </Table>
    </Card>
  );
}

function StockProductRow({ row }: { row: Overview["stockProducts"][number] }) {
  const save = useSaveBroilerStockProduct();
  const toast = useToast();
  const [kgPerUnit, setKgPerUnit] = useState(String(row.kgPerUnit));
  const [enabled, setEnabled] = useState(row.enabled);
  return (
    <TR>
      <TD><div className="font-medium">{row.product.description}</div><div className="font-mono text-[10px] text-muted-foreground">{row.product.sku}</div></TD>
      <TD align="right">{row.unit === "bags" ? `${(row.kgOnHand / row.kgPerUnit).toFixed(0)} bags` : `${row.kgOnHand.toFixed(3)} kg`}</TD>
      <TD><div className="flex items-center gap-1"><Input type="number" min="0.001" step="0.001" className="w-24 text-right" value={kgPerUnit} onChange={(e) => setKgPerUnit(e.target.value)} /><span className="text-xs text-muted-foreground">{row.unit === "bags" ? "kg/bag" : "kg"}</span></div></TD>
      <TD align="center"><input type="checkbox" aria-label={`Track ${row.product.sku}`} checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /></TD>
      <TD align="right"><Button size="sm" variant="outline" disabled={save.isPending} onClick={async () => { try { await save.mutateAsync({ productId: row.productId, enabled, kgPerUnit: Number(kgPerUnit) }); toast.push("Stock product saved.", "good"); } catch (error) { toast.push(errorMessage(error), "bad"); } }}>Save</Button></TD>
    </TR>
  );
}

function StockSection({ data }: { data: Overview }) {
  const preview = useBroilerRunStockPreview();
  const apply = useApplyBroilerRunStock();
  const reverse = useReverseBroilerRunStock();
  const adjust = useAdjustBroilerStock();
  const toast = useToast();
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [previewRows, setPreviewRows] = useState<any[]>([]);
  const [eggRows, setEggRows] = useState<any[]>([]);
  const [eggSummary, setEggSummary] = useState<{ currentEggs: number; requiredEggs: number; afterEggs: number; sufficient: boolean } | null>(null);
  const [adjustProduct, setAdjustProduct] = useState("");
  const [adjustKg, setAdjustKg] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  async function openPreview(run: Run) {
    try {
      const result = await preview.mutateAsync({ runId: run.id });
      setSelectedRun(run);
      setPreviewRows(result.requirements);
      setEggRows(result.eggRequirements);
      setEggSummary(result.eggStock);
    } catch (error) {
      toast.push(errorMessage(error), "bad");
    }
  }
  async function applySelected() {
    if (!selectedRun) return;
    try {
      const result = await apply.mutateAsync({ runId: selectedRun.id });
      setSelectedRun(null);
      toast.push(
        `${result.products} chicken products updated (${result.kg} kg); ${result.eggs} saleable eggs deducted.`,
        "good",
      );
    } catch (error) {
      toast.push(errorMessage(error), "bad");
    }
  }
  async function reverseRun(runId: number) {
    try {
      await reverse.mutateAsync({ runId });
      toast.push("Sales stock deduction reversed.", "good");
    } catch (error) {
      toast.push(errorMessage(error), "bad");
    }
  }
  return (
    <>
      <Card className="overflow-hidden">
        <div className="border-b border-border px-4 py-3"><h2 className="font-display text-xl text-primary">Chicken stock</h2><p className="mt-1 text-xs text-muted-foreground">Slaughter adds kg. Applying a Weekly Lists invoice report deducts sold chicken and saleable eggs once.</p></div>
        <Table><THead><TH>Product</TH><TH align="right">Stock</TH><TH align="right">kg / invoice unit</TH><TH align="center">Track</TH><TH /></THead><tbody>{data.stockProducts.map((row) => <StockProductRow key={row.productId} row={row} />)}</tbody></Table>
      </Card>
      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card className="p-5">
          <h3 className="font-display text-lg text-primary">Apply Weekly List sales</h3>
          <div className="mt-3 space-y-2">{data.salesRuns.map((run) => <div key={run.id} className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-2 text-sm"><span>{run.label} {run.stockAppliedAt && <Chip tone="good">stock applied</Chip>}</span><span className="flex gap-2"><Button size="sm" variant="outline" onClick={() => void openPreview(run)}>Review</Button>{run.stockAppliedAt && <Button size="sm" variant="outline" onClick={() => void reverseRun(run.id)}>Reverse</Button>}</span></div>)}</div>
        </Card>
        <Card className="p-5">
          <h3 className="font-display text-lg text-primary">Manual stock correction</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-2"><Field label="Product"><Select value={adjustProduct} onChange={(e) => setAdjustProduct(e.target.value)}><option value="">Choose product</option>{data.stockProducts.map((row) => <option key={row.productId} value={row.productId}>{row.product.sku} · {row.product.description}</option>)}</Select></Field><Field label={data.stockProducts.find((row) => String(row.productId) === adjustProduct)?.unit === "bags" ? "Change · bags" : "Change · kg"}><Input type="number" step="0.001" value={adjustKg} onChange={(e) => setAdjustKg(e.target.value)} placeholder="-2.5 or 2.5" /></Field><Field label="Reason" className="sm:col-span-2"><Input value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} /></Field></div>
          <Button className="mt-3" disabled={adjust.isPending || !adjustProduct || !Number(adjustKg) || adjustReason.trim().length < 3} onClick={async () => { try { await adjust.mutateAsync({ productId: Number(adjustProduct), deltaKg: Number(adjustKg), reason: adjustReason }); setAdjustKg(""); setAdjustReason(""); toast.push("Stock correction logged.", "good"); } catch (error) { toast.push(errorMessage(error), "bad"); } }}>Log correction</Button>
        </Card>
      </div>
      <Modal open={!!selectedRun} onClose={() => setSelectedRun(null)} title={`Apply ${selectedRun?.label ?? "report"} to stock`} subtitle="Invoice quantities are converted to kilograms using the stock product settings." footer={<><Button variant="outline" onClick={() => setSelectedRun(null)}>Cancel</Button><Button disabled={apply.isPending || selectedRun?.stockAppliedAt != null || previewRows.some((row) => !row.sufficient)} onClick={() => void applySelected()}>{apply.isPending ? "Applying…" : "Apply stock deduction"}</Button></>} wide>
        <Table><THead><TH>SKU</TH><TH>Product</TH><TH align="right">Invoice qty</TH><TH align="right">Required</TH><TH align="right">Stock after</TH></THead><tbody>{previewRows.map((row) => <TR key={row.productId}><TD className="font-mono">{row.sku}</TD><TD>{row.description}</TD><TD align="right">{row.invoiceQuantity}{row.unit === "bags" ? " bags" : ""}</TD><TD align="right">{row.unit === "bags" ? `${(row.requiredKg / row.kgPerUnit).toFixed(0)} bags` : `${row.requiredKg} kg`}</TD><TD align="right" className={row.sufficient ? "text-leaf" : "text-destructive"}>{row.unit === "bags" ? `${(row.afterKg / row.kgPerUnit).toFixed(0)} bags` : `${row.afterKg} kg`}</TD></TR>)}</tbody></Table>
        {selectedRun?.stockAppliedAt && <div className="mt-3"><Banner tone="good">This report is already applied. Reverse it before applying again.</Banner></div>}
      </Modal>
    </>
  );
}

function SetupSection({ data }: { data: Overview }) {
  const savePen = useSaveBroilerPen();
  const saveFeed = useSaveBroilerFeedType();
  const toast = useToast();
  const [penName, setPenName] = useState("");
  const [penKind, setPenKind] = useState<"brooder" | "pasture">("pasture");
  const [feedName, setFeedName] = useState("");
  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <Card className="p-5"><h3 className="font-display text-lg text-primary">Pens</h3><div className="mt-3 space-y-2">{data.pens.map((pen) => <div key={pen.id} className="flex items-center justify-between border-b border-border pb-2 text-sm"><span>{pen.name} <Chip>{pen.kind}</Chip></span><Button size="sm" variant="ghost" onClick={async () => { try { await savePen.mutateAsync({ id: pen.id, name: pen.name, kind: pen.kind as "brooder" | "pasture", active: !pen.active }); toast.push("Pen updated.", "good"); } catch (error) { toast.push(errorMessage(error), "bad"); } }}>{pen.active ? "Deactivate" : "Activate"}</Button></div>)}</div><div className="mt-4 flex gap-2"><Input placeholder="New pen name" value={penName} onChange={(e) => setPenName(e.target.value)} /><Select className="w-32" value={penKind} onChange={(e) => setPenKind(e.target.value as "brooder" | "pasture")}><option value="pasture">Pasture</option><option value="brooder">Brooder</option></Select><Button disabled={!penName.trim() || savePen.isPending} onClick={async () => { try { await savePen.mutateAsync({ name: penName, kind: penKind, active: true }); setPenName(""); toast.push("Pen added.", "good"); } catch (error) { toast.push(errorMessage(error), "bad"); } }}>Add</Button></div></Card>
      <Card className="p-5"><h3 className="font-display text-lg text-primary">Feed types</h3><div className="mt-3 space-y-2">{data.feedTypes.map((feed) => <div key={feed.id} className="flex items-center justify-between border-b border-border pb-2 text-sm"><span>{feed.name} · {feed.bagWeightKg}kg · {feed.bagsOnHand} bags</span><Button size="sm" variant="ghost" onClick={async () => { try { await saveFeed.mutateAsync({ id: feed.id, name: feed.name, bagWeightKg: feed.bagWeightKg, active: !feed.active }); toast.push("Feed updated.", "good"); } catch (error) { toast.push(errorMessage(error), "bad"); } }}>{feed.active ? "Deactivate" : "Activate"}</Button></div>)}</div><div className="mt-4 flex gap-2"><Input placeholder="New 40kg feed name" value={feedName} onChange={(e) => setFeedName(e.target.value)} /><Button disabled={!feedName.trim() || saveFeed.isPending} onClick={async () => { try { await saveFeed.mutateAsync({ name: feedName, bagWeightKg: 40, active: true }); setFeedName(""); toast.push("Feed added.", "good"); } catch (error) { toast.push(errorMessage(error), "bad"); } }}>Add</Button></div></Card>
    </div>
  );
}

function GasSection({ data }: { data: Overview }) {
  const saveSettings = useSaveBroilerGasSettings();
  const voidGas = useVoidBroilerGasMovement();
  const toast = useToast();
  const [bottleSize, setBottleSize] = useState(String(data.gas.bottleSizeKg));
  const [target, setTarget] = useState(String(data.gas.targetBottles));
  const [reason, setReason] = useState("");
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card className="p-5">
        <h2 className="font-display text-xl text-primary">Gas storage</h2>
        <p className="mt-1 text-xs text-muted-foreground">19 kg bottles heat the brooders. Employees log bottles in and out on the shared phone.</p>
        <div className="mt-3 flex items-end justify-between gap-3">
          <div><div className="font-display text-3xl text-primary">{data.gas.bottlesOnHand} bottles</div><div className="text-xs text-muted-foreground">{data.gas.bottleSizeKg} kg each · target {data.gas.targetBottles}</div></div>
          {data.gas.bottlesOnHand < data.gas.targetBottles && <Chip tone="warn">below target</Chip>}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3">
          <Field label="Bottle size · kg"><Input type="number" min="1" step="0.5" value={bottleSize} onChange={(e) => setBottleSize(e.target.value)} /></Field>
          <Field label="Target bottles"><Input type="number" min="0" step="1" value={target} onChange={(e) => setTarget(e.target.value)} /></Field>
        </div>
        <Button className="mt-3" size="sm" variant="outline" disabled={saveSettings.isPending} onClick={async () => { try { await saveSettings.mutateAsync({ revision: data.gas.revision, bottleSizeKg: Number(bottleSize), targetBottles: Number(target) }); toast.push("Gas settings saved.", "good"); } catch (error) { toast.push(errorMessage(error), "bad"); } }}>Save settings</Button>
      </Card>
      <Card className="overflow-hidden">
        <div className="border-b border-border px-4 py-3"><h2 className="font-display text-xl text-primary">Recent gas movements</h2></div>
        <div className="border-b border-border px-4 py-3"><Field label="Correction reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>
        <Table><THead><TH>Date</TH><TH>Entry</TH><TH>By</TH><TH align="right">Bottles</TH><TH /></THead><tbody>{data.gasHistory.slice(0, 12).map(({ movement, employee, batch, pen }) => <TR key={movement.id} className={movement.voidedAt ? "opacity-50" : ""}><TD>{shortDate(movement.movementDate)}</TD><TD>{movement.kind === "delivery" ? "In" : "Out"}{batch ? ` · ${batch}` : ""}{pen ? ` · ${pen}` : ""}</TD><TD>{employee ?? movement.actor}</TD><TD align="right">{movement.kind === "delivery" ? "+" : "−"}{movement.bottles}</TD><TD align="right">{!movement.voidedAt && <ConfirmButton title="Void gas entry" confirmLabel="Void" className="text-xs font-semibold text-destructive" onConfirm={async () => { if (reason.trim().length < 3) return toast.push("Enter a correction reason first.", "bad"); try { await voidGas.mutateAsync({ movementId: movement.id, reason }); toast.push("Gas entry voided.", "good"); } catch (error) { toast.push(errorMessage(error), "bad"); } }}>Void</ConfirmButton>}</TD></TR>)}
        {!data.gasHistory.length && <TR><TD colSpan={5}><Empty title="No gas movements yet" /></TD></TR>}</tbody></Table>
      </Card>
    </div>
  );
}

export default function Broilers() {
  const overview = useBroilerOverview();
  const voidFeed = useVoidBroilerFeedMovement();
  const toast = useToast();
  const [selectedBatchId, setSelectedBatchId] = useState<number | null>(null);
  const [feedReason, setFeedReason] = useState("");
  const data = overview.data;
  const stats = useMemo(() => {
    const batches = data?.batches ?? [];
    return {
      live: batches.reduce((sum, batch) => sum + batch.liveBirds, 0),
      active: batches.filter((batch) => batch.status === "active").length,
      feed: data?.feedTypes.reduce((sum, feed) => sum + feed.bagsOnHand, 0) ?? 0,
      stock: data?.stockProducts.reduce((sum, row) => sum + row.kgOnHand, 0) ?? 0,
    };
  }, [data]);
  const selected = data?.batches.find((batch) => batch.id === selectedBatchId) ?? data?.batches[0];
  if (overview.isLoading) return <Loading label="Loading Pastured Broilers" />;
  if (overview.error || !data) return <Banner tone="bad">{errorMessage(overview.error)}</Banner>;
  return (
    <>
      <PageHeader title="Pastured Broilers" subtitle="Plan chick arrivals, reconcile brooder and pasture counts, track feed and turn slaughter weights into chicken stock." actions={<Link to="/broilers/log"><Button><ArrowUpRight />Employee log</Button></Link>} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5"><Stat label="Live birds" value={stats.live} /><Stat label="Active batches" value={stats.active} /><Stat label="Feed bags" value={stats.feed} /><Stat label="Gas bottles" value={data.gas.bottlesOnHand} /><Stat label="Chicken stock" value={`${stats.stock.toFixed(1)} kg`} /></div>
      <div className="mb-5 grid gap-5 xl:grid-cols-2"><PlanCard today={data.today} /><ArrivalCard data={data} /></div>
      <Card className="mb-5 overflow-hidden"><div className="border-b border-border px-4 py-3"><h2 className="font-display text-xl text-primary">Batch register</h2></div><Table><THead><TH>Batch</TH><TH>Planned</TH><TH>Received</TH><TH align="right">Live</TH><TH>Location</TH><TH>Status</TH></THead><tbody>{data.batches.map((batch) => <TR key={batch.id} onClick={() => setSelectedBatchId(batch.id)} className={selected?.id === batch.id ? "bg-accent/6" : ""}><TD><div className="font-semibold">{batch.name}</div><div className="text-xs text-muted-foreground">rev {batch.revision}</div></TD><TD>{shortDate(batch.plannedDate)} · {batch.plannedCount}</TD><TD>{batch.actualDate ? `${shortDate(batch.actualDate)} · ${batch.receivedCount}` : "—"}</TD><TD align="right">{batch.liveBirds}</TD><TD><div className="flex flex-wrap gap-1">{batch.pens.map((pen) => <Chip key={pen.id}>{pen.name}: {pen.birdCount}</Chip>)}</div></TD><TD><Chip tone={batch.status === "active" ? "good" : "neutral"}>{batch.status}</Chip></TD></TR>)}</tbody></Table></Card>
      {selected && <div className="mb-5"><BatchDetail batch={selected} events={data.events} stockProducts={data.stockProducts} /></div>}
      <div className="mb-5"><GasSection data={data} /></div>
      <div className="mb-5 grid gap-5 xl:grid-cols-2"><Card className="overflow-hidden"><div className="border-b border-border px-4 py-3"><h2 className="font-display text-xl text-primary">Feed storage</h2></div><Table><THead><TH>Feed</TH><TH align="right">Bag kg</TH><TH align="right">Bags left</TH><TH align="right">Total kg</TH></THead><tbody>{data.feedTypes.map((feed) => <TR key={feed.id}><TD>{feed.name}</TD><TD align="right">{feed.bagWeightKg}</TD><TD align="right">{feed.bagsOnHand}</TD><TD align="right">{feed.bagsOnHand * feed.bagWeightKg}</TD></TR>)}</tbody></Table></Card><Card className="overflow-hidden"><div className="border-b border-border px-4 py-3"><h2 className="font-display text-xl text-primary">Recent feed movements</h2></div><div className="border-b border-border px-4 py-3"><Field label="Correction reason"><Input value={feedReason} onChange={(e) => setFeedReason(e.target.value)} /></Field></div><Table><THead><TH>Date</TH><TH>Entry</TH><TH>By</TH><TH align="right">Bags</TH><TH /></THead><tbody>{data.feedHistory.slice(0, 12).map(({ movement, feed, employee, batch, pen }) => <TR key={movement.id} className={movement.voidedAt ? "opacity-50" : ""}><TD>{shortDate(movement.movementDate)}</TD><TD>{movement.kind === "delivery" ? "In" : "Out"} · {feed}{batch ? ` · ${batch}` : ""}{pen ? ` · ${pen}` : ""}</TD><TD>{employee ?? movement.actor}</TD><TD align="right">{movement.kind === "delivery" ? "+" : "−"}{movement.bags}</TD><TD align="right">{!movement.voidedAt && <ConfirmButton title="Void feed entry" confirmLabel="Void" className="text-xs font-semibold text-destructive" onConfirm={async () => { if (feedReason.trim().length < 3) return toast.push("Enter a correction reason first.", "bad"); try { await voidFeed.mutateAsync({ movementId: movement.id, reason: feedReason }); toast.push("Feed entry voided.", "good"); } catch (error) { toast.push(errorMessage(error), "bad"); } }}>Void</ConfirmButton>}</TD></TR>)}</tbody></Table></Card></div>
      <StockSection data={data} />
      <div className="mt-5"><SetupSection data={data} /></div>
      <div className="mt-5"><Banner><Package className="mr-1 inline size-4" /> Employee logging is at <strong>/broilers/log</strong>. Arrivals, setup, stock application and corrections require manager sign-in.</Banner></div>
    </>
  );
}
