import { useState } from "react";
import { Link } from "wouter";
import { ArrowUpRight, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Banner, Card, Chip, ConfirmButton, Loading, PageHeader, Stat } from "@/components/ui/misc";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/toast";
import {
  useAdjustEggStock,
  useLayerOverview,
  useSaveEggMobile,
  useSaveEggStockProduct,
  useVoidEggCollection,
  useVoidLayerBirdEvent,
  useVoidLayerFeedMovement,
} from "@/queries/layers";
import { errorMessage, shortDate } from "@/lib/format";

type Overview = NonNullable<ReturnType<typeof useLayerOverview>["data"]>;

function StockProductRow({ row }: { row: Overview["stockProducts"][number] }) {
  const save = useSaveEggStockProduct();
  const toast = useToast();
  const [eggsPerUnit, setEggsPerUnit] = useState(String(row.eggsPerUnit));
  const [enabled, setEnabled] = useState(row.enabled);
  return (
    <TR>
      <TD><div className="font-medium">{row.product.description}</div><div className="font-mono text-[10px] text-muted-foreground">{row.product.sku}</div></TD>
      <TD><Input type="number" min="1" step="1" className="w-24 text-right" value={eggsPerUnit} onChange={(e) => setEggsPerUnit(e.target.value)} /></TD>
      <TD align="center"><input type="checkbox" aria-label={`Track ${row.product.sku}`} checked={enabled} onChange={(e) => setEnabled(e.target.checked)} /></TD>
      <TD align="right"><Button size="sm" variant="outline" disabled={save.isPending} onClick={async () => { try { await save.mutateAsync({ productId: row.productId, enabled, eggsPerUnit: Number(eggsPerUnit) }); toast.push("Egg product saved.", "good"); } catch (error) { toast.push(errorMessage(error), "bad"); } }}>Save</Button></TD>
    </TR>
  );
}

function EggStockSection({ data }: { data: Overview }) {
  const adjust = useAdjustEggStock();
  const toast = useToast();
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");
  const change = Number(delta || 0);
  return (
    <>
      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <div className="border-b border-border px-4 py-3"><h2 className="font-display text-xl text-primary">Saleable egg stock</h2><p className="mt-1 text-xs text-muted-foreground">Daily collections add saleable eggs here. Applying a Weekly Lists invoice report on the Pastured Broilers page deducts sold packs from this pool.</p></div>
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4">
            <div><div className="font-display text-3xl text-primary">{data.eggStock.eggsOnHand} eggs</div><div className="text-xs text-muted-foreground">loose saleable eggs on hand · rev {data.eggStock.revision}</div></div>
            <div className="flex flex-wrap gap-1">{data.stockProducts.filter((row) => row.enabled).map((row) => <Chip key={row.productId}>{row.product.sku} = {row.eggsPerUnit} eggs</Chip>)}</div>
          </div>
          <Table><THead><TH>Product</TH><TH align="right">Eggs / invoice unit</TH><TH align="center">Track</TH><TH /></THead><tbody>{data.stockProducts.map((row) => <StockProductRow key={row.productId} row={row} />)}</tbody></Table>
        </Card>
        <Card className="overflow-hidden">
          <div className="border-b border-border px-4 py-3"><h2 className="font-display text-xl text-primary">Stock ledger</h2></div>
          <Table><THead><TH>When</TH><TH>Entry</TH><TH>By</TH><TH align="right">Eggs</TH></THead><tbody>{data.stockMovements.slice(0, 12).map(({ movement, employee }) => <TR key={movement.id}><TD>{shortDate(movement.createdAt)}</TD><TD>{movement.kind.replaceAll("_", " ")}{movement.note ? ` · ${movement.note}` : ""}</TD><TD>{employee ?? movement.actor}</TD><TD align="right">{movement.quantityEggs > 0 ? "+" : ""}{movement.quantityEggs}</TD></TR>)}</tbody></Table>
          {!data.stockMovements.length && <div className="px-4 py-6 text-sm text-muted-foreground">No egg stock movements yet.</div>}
        </Card>
      </div>
      <Card className="mt-5 p-5">
        <h3 className="font-display text-lg text-primary">Manual stock correction</h3>
        <p className="mt-1 text-xs text-muted-foreground">For eggs used on the farm, given away or found extra. Negative changes can never exceed the stock on hand.</p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Field label="Change · eggs"><Input type="number" step="1" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="-30 or 30" /></Field>
          <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
        <div className="mt-3 flex items-center gap-3">
          <Button disabled={adjust.isPending || !change || reason.trim().length < 3} onClick={async () => { try { const result = await adjust.mutateAsync({ revision: data.eggStock.revision, delta: change, note: reason }); setDelta(""); setReason(""); toast.push(`Stock correction logged — ${result.eggsOnHand} eggs on hand.`, "good"); } catch (error) { toast.push(errorMessage(error), "bad"); } }}>Log correction</Button>
          {change < 0 && <span className="text-xs text-muted-foreground">{data.eggStock.eggsOnHand + change} eggs would remain.</span>}
        </div>
      </Card>
    </>
  );
}

function CollectionsSection({ data }: { data: Overview }) {
  const voidCollection = useVoidEggCollection();
  const toast = useToast();
  const [reason, setReason] = useState("");
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border px-4 py-3"><h2 className="font-display text-xl text-primary">Egg collections</h2><p className="mt-1 text-xs text-muted-foreground">One entry per mobile per day; laid always equals saleable + broken.</p></div>
      <div className="border-b border-border px-4 py-3"><Field label="Correction reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>
      <Table><THead><TH>Date</TH><TH>Mobile</TH><TH align="right">Laid</TH><TH align="right">Saleable</TH><TH align="right">Broken</TH><TH>By</TH><TH /></THead><tbody>{data.collections.slice(0, 20).map(({ collection, mobile, employee }) => <TR key={collection.id} className={collection.voidedAt ? "opacity-50" : ""}><TD>{shortDate(collection.collectionDate)}</TD><TD>{mobile}</TD><TD align="right">{collection.laid}</TD><TD align="right">{collection.saleable}</TD><TD align="right">{collection.broken}</TD><TD>{employee ?? collection.actor}{collection.note ? <div className="text-xs text-muted-foreground">{collection.note}</div> : null}{collection.voidedAt ? <div className="text-xs text-destructive">Voided · {collection.voidReason}</div> : null}</TD><TD align="right">{!collection.voidedAt && <ConfirmButton title="Void collection" confirmLabel="Void" className="text-xs font-semibold text-destructive" onConfirm={async () => { if (reason.trim().length < 3) return toast.push("Enter a correction reason first.", "bad"); try { await voidCollection.mutateAsync({ collectionId: collection.id, reason }); toast.push("Collection voided; saleable eggs removed from stock.", "good"); } catch (error) { toast.push(errorMessage(error), "bad"); } }}>Void</ConfirmButton>}</TD></TR>)}</tbody></Table>
      {!data.collections.length && <div className="px-4 py-6 text-sm text-muted-foreground">No egg collections logged yet.</div>}
    </Card>
  );
}

function BirdsSection({ data }: { data: Overview }) {
  const voidEvent = useVoidLayerBirdEvent();
  const toast = useToast();
  const [reason, setReason] = useState("");
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border px-4 py-3"><h2 className="font-display text-xl text-primary">Layer flock register</h2><p className="mt-1 text-xs text-muted-foreground">Arrivals, deaths and moves between mobiles. Corrections void the original event.</p></div>
      <div className="border-b border-border px-4 py-3"><Field label="Correction reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>
      <Table><THead><TH>Date</TH><TH>Mobile</TH><TH>Event</TH><TH align="right">Birds</TH><TH>By</TH><TH /></THead><tbody>{data.birdEvents.slice(0, 20).map(({ event, mobile, toMobile, employee }) => <TR key={event.id} className={event.voidedAt ? "opacity-50" : ""}><TD>{shortDate(event.eventDate)}</TD><TD>{mobile}</TD><TD>{event.kind === "arrival" ? "Arrival" : event.kind === "death" ? "Deaths" : `Move → ${toMobile ?? "?"}`}{event.note ? <div className="text-xs text-muted-foreground">{event.note}</div> : null}{event.voidedAt ? <div className="text-xs text-destructive">Voided · {event.voidReason}</div> : null}</TD><TD align="right">{event.count}</TD><TD>{employee ?? event.actor}</TD><TD align="right">{!event.voidedAt && <ConfirmButton title="Void bird event" confirmLabel="Void" className="text-xs font-semibold text-destructive" onConfirm={async () => { if (reason.trim().length < 3) return toast.push("Enter a correction reason first.", "bad"); try { await voidEvent.mutateAsync({ eventId: event.id, reason }); toast.push("Bird event voided; counts reversed.", "good"); } catch (error) { toast.push(errorMessage(error), "bad"); } }}>Void</ConfirmButton>}</TD></TR>)}</tbody></Table>
      {!data.birdEvents.length && <div className="px-4 py-6 text-sm text-muted-foreground">No layer flock events yet.</div>}
    </Card>
  );
}

function FeedSection({ data }: { data: Overview }) {
  const voidFeed = useVoidLayerFeedMovement();
  const toast = useToast();
  const [reason, setReason] = useState("");
  return (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card className="overflow-hidden">
        <div className="border-b border-border px-4 py-3"><h2 className="font-display text-xl text-primary">Layer feed storage</h2><p className="mt-1 text-xs text-muted-foreground">Employees log bags delivered and bags taken out to the mobiles on the shared phone.</p></div>
        <Table><THead><TH>Feed</TH><TH align="right">Bag kg</TH><TH align="right">Bags left</TH><TH align="right">Total kg</TH></THead><tbody>{data.feedTypes.map((feed) => <TR key={feed.id}><TD>{feed.name}</TD><TD align="right">{feed.bagWeightKg}</TD><TD align="right">{feed.bagsOnHand}</TD><TD align="right">{feed.bagsOnHand * feed.bagWeightKg}</TD></TR>)}</tbody></Table>
      </Card>
      <Card className="overflow-hidden">
        <div className="border-b border-border px-4 py-3"><h2 className="font-display text-xl text-primary">Recent feed movements</h2></div>
        <div className="border-b border-border px-4 py-3"><Field label="Correction reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field></div>
        <Table><THead><TH>Date</TH><TH>Entry</TH><TH>By</TH><TH align="right">Bags</TH><TH /></THead><tbody>{data.feedHistory.slice(0, 12).map(({ movement, feed, mobile, employee }) => <TR key={movement.id} className={movement.voidedAt ? "opacity-50" : ""}><TD>{shortDate(movement.movementDate)}</TD><TD>{movement.kind === "delivery" ? "In" : "Out"} · {feed}{mobile ? ` · ${mobile}` : ""}{movement.voidedAt ? <div className="text-xs text-destructive">Voided · {movement.voidReason}</div> : null}</TD><TD>{employee ?? movement.actor}</TD><TD align="right">{movement.kind === "delivery" ? "+" : "−"}{movement.bags}</TD><TD align="right">{!movement.voidedAt && <ConfirmButton title="Void feed entry" confirmLabel="Void" className="text-xs font-semibold text-destructive" onConfirm={async () => { if (reason.trim().length < 3) return toast.push("Enter a correction reason first.", "bad"); try { await voidFeed.mutateAsync({ movementId: movement.id, reason }); toast.push("Feed entry voided; bags restored.", "good"); } catch (error) { toast.push(errorMessage(error), "bad"); } }}>Void</ConfirmButton>}</TD></TR>)}</tbody></Table>
        {!data.feedHistory.length && <div className="px-4 py-6 text-sm text-muted-foreground">No layer feed movements yet.</div>}
      </Card>
    </div>
  );
}

function MobilesSection({ data }: { data: Overview }) {
  const save = useSaveEggMobile();
  const toast = useToast();
  const [name, setName] = useState("");
  return (
    <Card className="p-5">
      <h3 className="font-display text-lg text-primary">Egg mobiles</h3>
      <div className="mt-3 space-y-2">{data.mobiles.map((mobile) => <div key={mobile.id} className="flex items-center justify-between border-b border-border pb-2 text-sm"><span>{mobile.name} <Chip>{mobile.birdCount} hens</Chip></span><Button size="sm" variant="ghost" onClick={async () => { try { await save.mutateAsync({ id: mobile.id, name: mobile.name, active: !mobile.active }); toast.push("Mobile updated.", "good"); } catch (error) { toast.push(errorMessage(error), "bad"); } }}>{mobile.active ? "Deactivate" : "Activate"}</Button></div>)}</div>
      <div className="mt-4 flex gap-2"><Input placeholder="New mobile name" value={name} onChange={(e) => setName(e.target.value)} /><Button disabled={!name.trim() || save.isPending} onClick={async () => { try { await save.mutateAsync({ name, active: true }); setName(""); toast.push("Egg mobile added.", "good"); } catch (error) { toast.push(errorMessage(error), "bad"); } }}>Add</Button></div>
    </Card>
  );
}

export default function Layers() {
  const overview = useLayerOverview();
  const data = overview.data;
  if (overview.isLoading) return <Loading label="Loading Pastured Layers" />;
  if (overview.error || !data) return <Banner tone="bad">{errorMessage(overview.error)}</Banner>;
  return (
    <>
      <PageHeader title="Pastured Layers" subtitle="Track the egg mobiles, the daily collection and the saleable egg stock that invoices deduct from." actions={<Link to="/layers/log"><Button><ArrowUpRight />Employee log</Button></Link>} />
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-6"><Stat label="Laying hens" value={data.stats.birds} /><Stat label="Eggs today" value={data.stats.laidToday} /><Stat label="Saleable today" value={data.stats.saleableToday} /><Stat label="Broken today" value={data.stats.brokenToday} /><Stat label="Egg stock" value={`${data.eggStock.eggsOnHand} eggs`} /><Stat label="Layer feed" value={`${data.feedTypes.reduce((sum, feed) => sum + feed.bagsOnHand, 0)} bags`} /></div>
      <Card className="mb-5 overflow-hidden"><div className="border-b border-border px-4 py-3"><h2 className="font-display text-xl text-primary">Egg mobiles</h2></div><Table><THead><TH>Mobile</TH><TH align="right">Hens</TH><TH align="right">Laid today</TH><TH align="right">Saleable</TH><TH align="right">Broken</TH><TH>Status</TH></THead><tbody>{data.mobiles.map((mobile) => { const todayRow = data.collections.find((row) => !row.collection.voidedAt && row.collection.mobileId === mobile.id && row.collection.collectionDate === data.today)?.collection; return <TR key={mobile.id}><TD className="font-semibold">{mobile.name}</TD><TD align="right">{mobile.birdCount}</TD><TD align="right">{todayRow ? todayRow.laid : "—"}</TD><TD align="right">{todayRow ? todayRow.saleable : "—"}</TD><TD align="right">{todayRow ? todayRow.broken : "—"}</TD><TD><Chip tone={mobile.active ? (todayRow ? "good" : "neutral") : "neutral"}>{mobile.active ? (todayRow ? "collected" : "not collected") : "inactive"}</Chip></TD></TR>; })}</tbody></Table></Card>
      <div className="mb-5"><CollectionsSection data={data} /></div>
      <div className="mb-5"><BirdsSection data={data} /></div>
      <div className="mb-5"><FeedSection data={data} /></div>
      <div className="mb-5"><EggStockSection data={data} /></div>
      <div className="mb-5 grid gap-5 lg:grid-cols-2"><MobilesSection data={data} /><Card className="p-5"><h3 className="font-display text-lg text-primary">How egg stock works</h3><ul className="mt-3 space-y-2 text-sm text-muted-foreground"><li>Employees log each mobile's collection on the shared phone: laid = saleable + broken.</li><li>Saleable eggs add to the loose egg stock; broken eggs never touch stock.</li><li>Applying a Weekly List invoice report deducts sold packs (EGG030 = 30 eggs, EGG006 = 6) from the egg stock — review it under Pastured Broilers → Apply Weekly List sales.</li><li>Voiding a collection removes its saleable eggs again — unless they are already sold.</li></ul></Card></div>
      <div className="mt-5"><Banner><Package className="mr-1 inline size-4" /> Employee logging is at <strong>/layers/log</strong>. Mobiles setup, stock products and corrections require manager sign-in.</Banner></div>
    </>
  );
}
