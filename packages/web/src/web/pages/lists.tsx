import * as React from "react";
import { Download, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Banner,
  Card,
  Chip,
  ConfirmButton,
  Empty,
  Loading,
  Modal,
  PageHeader,
  Stat,
} from "@/components/ui/misc";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { CsvUpload } from "@/components/csv-upload";
import { useToast } from "@/components/toast";
import {
  useExportList,
  useImportReport,
  useRemoveRun,
  useRunDetail,
  useRuns,
  useSaveRecipe,
  type WeeklyList,
} from "@/queries/lists";
import { errorMessage, shortDate } from "@/lib/format";

const qty = (n: number) => Math.round(n * 1000) / 1000;

/** A download-able list card with a preview of its rows. */
function ListCard({
  title,
  hint,
  columns,
  rows,
  empty,
  onDownload,
  busy,
}: {
  title: string;
  hint: string;
  columns: string[];
  rows: (string | number)[][];
  empty: string;
  onDownload: () => void;
  busy?: boolean;
}) {
  const [expanded, setExpanded] = React.useState(false);
  const shown = expanded ? rows : rows.slice(0, 8);

  return (
    <Card className="flex flex-col overflow-hidden">
      <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3">
        <div>
          <div className="font-display text-[15px] font-semibold text-primary">{title}</div>
          <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>
        </div>
        <Button
          size="sm"
          variant="outline"
          disabled={rows.length === 0 || busy}
          onClick={onDownload}
        >
          <Download /> CSV
        </Button>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-6 text-[12px] text-muted-foreground">{empty}</div>
      ) : (
        <>
          <Table>
            <THead>
              {columns.map((c, i) => (
                <TH key={c} align={i === columns.length - 1 ? "right" : "left"}>
                  {c}
                </TH>
              ))}
            </THead>
            <tbody>
              {shown.map((r, ri) => (
                <TR key={`${r[0]}-${ri}`}>
                  {r.map((cell, ci) => (
                    <TD
                      key={`${ci}-${String(cell)}`}
                      align={ci === r.length - 1 ? "right" : "left"}
                      className={ci === 0 ? "font-mono text-[12px]" : undefined}
                    >
                      {cell === "" ? "—" : cell}
                    </TD>
                  ))}
                </TR>
              ))}
            </tbody>
          </Table>
          {rows.length > 8 && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="border-t border-border px-4 py-2 text-[12px] font-medium text-accent hover:bg-muted/50"
            >
              {expanded ? "Show less" : `Show all ${rows.length} rows`}
            </button>
          )}
        </>
      )}
    </Card>
  );
}

export default function Lists() {
  const toast = useToast();
  const runs = useRuns();
  const importReport = useImportReport();
  const saveRecipe = useSaveRecipe();
  const removeRun = useRemoveRun();
  const exportList = useExportList();

  const [selected, setSelected] = React.useState<number | null>(null);
  const [uploadOpen, setUploadOpen] = React.useState(false);
  const [boxSku, setBoxSku] = React.useState("VEGBOX");
  /** SKU → quantity per box, as typed. Empty string means "not in the box". */
  const [draft, setDraft] = React.useState<Record<string, string>>({});
  const [dirty, setDirty] = React.useState(false);
  const [addSku, setAddSku] = React.useState("");

  const runList = runs.data ?? [];
  const runId = selected ?? runList[0]?.id ?? null;
  const detail = useRunDetail(runId);
  const d = detail.data;

  // Seed the editor from the saved recipe once per run + box. Keyed so a background
  // refetch never overwrites quantities the user is still typing.
  const seeded = React.useRef<string>("");
  React.useEffect(() => {
    if (!d) return;
    const sku = d.boxSkus.includes(boxSku) ? boxSku : (d.boxSkus[0] ?? "VEGBOX");
    if (sku !== boxSku) {
      setBoxSku(sku);
      return;
    }
    const key = `${d.run.id}:${sku}`;
    if (seeded.current === key) return;
    seeded.current = key;
    const next: Record<string, string> = {};
    for (const r of d.recipe) {
      if (r.boxSku === sku) next[r.sku] = String(r.qtyPerBox);
    }
    setDraft(next);
    setDirty(false);
  }, [d, boxSku]);

  const doImport = async (payload: { base64?: string; csv?: string }, fileName: string) => {
    try {
      const res = await importReport.mutateAsync({ ...payload, fileName });
      setSelected(res.runId);
      setUploadOpen(false);
      toast.push(
        `${res.label} imported — ${res.lineCount} lines, ${res.boxCount} boxes${
          res.carriedOver > 0 ? `, last week's box contents carried over` : ""
        }.`,
        "good",
      );
    } catch (err) {
      toast.push(errorMessage(err), "bad");
    }
  };

  const doSave = async () => {
    if (!runId) return;
    const items = Object.entries(draft)
      .map(([sku, value]) => ({
        sku,
        description: d?.vegOptions.find((v) => v.sku === sku)?.description ?? "",
        qtyPerBox: Number(value),
      }))
      .filter((i) => Number.isFinite(i.qtyPerBox) && i.qtyPerBox > 0);
    try {
      const res = await saveRecipe.mutateAsync({ runId, boxSku, items });
      setDirty(false);
      toast.push(
        res.saved === 0
          ? "Box emptied — the harvest list now only covers loose orders."
          : `${res.saved} veg saved for ${boxSku}.`,
        "good",
      );
    } catch (err) {
      toast.push(errorMessage(err), "bad");
    }
  };

  const doExport = async (list: WeeklyList) => {
    if (!runId) return;
    try {
      const res = await exportList.mutateAsync({ runId, list });
      toast.push(`${res.fileName} downloaded.`, "good");
    } catch (err) {
      toast.push(errorMessage(err), "bad");
    }
  };

  const setQty = (sku: string, value: string) => {
    setDraft((prev) => ({ ...prev, [sku]: value }));
    setDirty(true);
  };

  const boxCount = d?.run.boxCount ?? 0;
  const inBox = Object.entries(draft).filter(([, v]) => Number(v) > 0);

  return (
    <div>
      <PageHeader
        title="Weekly Lists"
        subtitle="Import the week's Xero “Inventory Item Details” report, pick what goes in the veg boxes, then download the harvest, meat, egg and supplier lists."
        actions={
          <Button onClick={() => setUploadOpen(true)}>
            <Plus /> Import week
          </Button>
        }
      />

      {runs.isLoading ? (
        <Card>
          <Loading label="Loading weeks" />
        </Card>
      ) : runList.length === 0 ? (
        <Card className="p-6">
          <Empty
            title="No weeks imported yet"
            hint="In Xero, run Reports → Inventory Item Details for the delivery week and export it. Drop that file here and every list is built from it."
          />
          <div className="mx-auto mt-2 max-w-xl">
            <CsvUpload
              busy={importReport.isPending}
              accept=".xlsx,.xls,.csv"
              label="Drop the Inventory Item Details export here"
              hint="Xero .xlsx or .csv. Quantities are read off the QoH movement column, so it must be the item details report — not a summary."
              onBinaryFile={(base64, fileName) => void doImport({ base64 }, fileName)}
              onFile={(csv, fileName) => void doImport({ csv }, fileName)}
            />
          </div>
        </Card>
      ) : (
        <>
          <div className="mb-5 flex flex-wrap items-center gap-2">
            {runList.map((r) => (
              <button
                type="button"
                key={r.id}
                onClick={() => setSelected(r.id)}
                className={
                  r.id === runId
                    ? "rounded-md bg-primary px-3 py-1.5 text-[12px] font-semibold text-primary-foreground"
                    : "rounded-md border border-border bg-card px-3 py-1.5 text-[12px] font-medium text-muted-foreground hover:border-accent/60 hover:text-primary"
                }
              >
                {r.periodFrom ? shortDate(r.periodFrom) : r.label}
                {r.periodTo ? ` – ${shortDate(r.periodTo)}` : ""}
              </button>
            ))}
          </div>

          {detail.isLoading || !d ? (
            <Card>
              <Loading label="Building lists" />
            </Card>
          ) : (
            <>
              <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
                <Stat label="Veg boxes sold" value={qty(boxCount)} tone="good" hint={boxSku} />
                <Stat label="Veg to harvest" value={d.harvest.length} hint="SKUs on the list" />
                <Stat label="Meat lines" value={d.meatAllocation.length} hint="per customer" />
                <Stat label="Egg lines" value={d.eggAllocation.length} hint="per customer" />
                <Stat
                  label="Supplier items"
                  value={d.veldwonder.length + d.milkwood.length}
                  hint="VeldWonder + Milkwood"
                />
              </div>

              {d.unclassified.length > 0 && (
                <div className="mb-4">
                  <Banner tone="warn">
                    {d.unclassified.length} SKU
                    {d.unclassified.length === 1 ? "" : "s"} did not match a list prefix (
                    {d.unclassified.map((u) => u.sku).join(", ")}). Set the list on the product in
                    the catalog to route them.
                  </Banner>
                </div>
              )}

              <Card className="mb-5 overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
                  <div>
                    <div className="font-display text-[15px] font-semibold text-primary">
                      What goes in the box this week
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      Quantity is per box. It is multiplied by the {qty(boxCount)} boxes sold and
                      added to the harvest list. Saved against this week only, so past weeks stay
                      on record.
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {d.boxSkus.length > 1 &&
                      d.boxSkus.map((sku) => (
                        <button
                          type="button"
                          key={sku}
                          onClick={() => setBoxSku(sku)}
                          className={
                            sku === boxSku
                              ? "rounded-md bg-secondary px-2.5 py-1 font-mono text-[12px] font-semibold text-secondary-foreground"
                              : "rounded-md px-2.5 py-1 font-mono text-[12px] text-muted-foreground hover:bg-muted"
                          }
                        >
                          {sku}
                        </button>
                      ))}
                    <Button size="sm" disabled={!dirty || saveRecipe.isPending} onClick={doSave}>
                      {saveRecipe.isPending ? "Saving…" : dirty ? "Save box" : "Saved"}
                    </Button>
                  </div>
                </div>

                <div className="grid gap-x-6 gap-y-1 px-4 py-3 sm:grid-cols-2 lg:grid-cols-3">
                  {d.vegOptions.length === 0 ? (
                    <div className="text-[12px] text-muted-foreground">
                      No veg SKUs found. Add VEG products to the catalog first.
                    </div>
                  ) : (
                    d.vegOptions.map((v) => {
                      const value = draft[v.sku] ?? "";
                      const on = Number(value) > 0;
                      return (
                        <label
                          key={v.sku}
                          className="flex items-center justify-between gap-3 rounded-md px-1.5 py-1.5 hover:bg-muted/50"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <input
                              type="checkbox"
                              aria-label={`Put ${v.description} in the box`}
                              checked={on}
                              onChange={(e) => setQty(v.sku, e.target.checked ? "1" : "")}
                              className="size-3.5 accent-accent"
                            />
                            <span className="min-w-0">
                              <span className="block truncate text-[12.5px] font-medium text-primary">
                                {v.description}
                              </span>
                              <span className="font-mono text-[10.5px] text-muted-foreground">
                                {v.sku}
                              </span>
                            </span>
                          </span>
                          <Input
                            value={value}
                            inputMode="decimal"
                            placeholder="0"
                            onChange={(e) => setQty(v.sku, e.target.value)}
                            className="h-7 w-16 text-right text-[12px]"
                          />
                        </label>
                      );
                    })
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
                  <Input
                    value={addSku}
                    placeholder="Add another SKU, e.g. VEG031"
                    onChange={(e) => setAddSku(e.target.value)}
                    className="h-8 w-56 text-[12px]"
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!addSku.trim()}
                    onClick={() => {
                      setQty(addSku.trim().toUpperCase(), "1");
                      setAddSku("");
                    }}
                  >
                    Add
                  </Button>
                  <span className="ml-auto text-[11px] text-muted-foreground">
                    {inBox.length} veg in the box
                  </span>
                </div>
              </Card>

              <div className="mb-5 grid gap-4 xl:grid-cols-2">
                <ListCard
                  title="Harvest list"
                  hint="Every vegetable needed, loose orders and box contents combined into one total."
                  columns={["SKU", "Vegetable", "Loose", "Boxes", "Harvest"]}
                  rows={d.harvest.map((r) => [
                    r.sku,
                    r.item,
                    qty(r.loose),
                    qty(r.boxes),
                    qty(r.total),
                  ])}
                  empty="No veg on this week's report yet."
                  onDownload={() => void doExport("harvest")}
                  busy={exportList.isPending}
                />
                <ListCard
                  title="Meat allocation"
                  hint="Chicken, beef and lamb per customer, with a total per cut."
                  columns={["SKU", "Item", "Customer", "Invoice", "Qty"]}
                  rows={d.meatAllocation.map((l) => [
                    l.sku,
                    l.itemName,
                    l.contact,
                    l.reference,
                    qty(l.quantity),
                  ])}
                  empty="No meat on this week's report."
                  onDownload={() => void doExport("meat")}
                  busy={exportList.isPending}
                />
                <ListCard
                  title="Egg packing list"
                  hint="Egg orders per customer, with a total per pack size."
                  columns={["SKU", "Item", "Customer", "Invoice", "Qty"]}
                  rows={d.eggAllocation.map((l) => [
                    l.sku,
                    l.itemName,
                    l.contact,
                    l.reference,
                    qty(l.quantity),
                  ])}
                  empty="No eggs on this week's report."
                  onDownload={() => void doExport("eggs")}
                  busy={exportList.isPending}
                />
                <ListCard
                  title="VeldWonder order"
                  hint="What to order in from VeldWonder (VW SKUs)."
                  columns={["SKU", "Product", "Order"]}
                  rows={d.veldwonder.map((r) => [r.sku, r.itemName, qty(r.quantity)])}
                  empty="Nothing to order from VeldWonder."
                  onDownload={() => void doExport("veldwonder")}
                  busy={exportList.isPending}
                />
                <ListCard
                  title="Milkwood order"
                  hint="What to order in from Milkwood (MW SKUs)."
                  columns={["SKU", "Product", "Order"]}
                  rows={d.milkwood.map((r) => [r.sku, r.itemName, qty(r.quantity)])}
                  empty="Nothing to order from Milkwood."
                  onDownload={() => void doExport("milkwood")}
                  busy={exportList.isPending}
                />
              </div>

              <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="text-[12px] text-muted-foreground">
                  <Chip>{d.run.fileName || "uploaded report"}</Chip>{" "}
                  <span className="ml-1">
                    imported {shortDate(new Date(d.run.createdAt).toISOString().slice(0, 10))}
                  </span>
                </div>
                <ConfirmButton
                  title="Delete this week"
                  confirmLabel="Delete week"
                  className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-destructive hover:bg-destructive/10"
                  onConfirm={async () => {
                    if (!runId) return;
                    try {
                      await removeRun.mutateAsync({ runId });
                      setSelected(null);
                      toast.push("Week deleted.", "good");
                    } catch (err) {
                      toast.push(errorMessage(err), "bad");
                    }
                  }}
                >
                  <Trash2 className="size-3.5" /> Delete week
                </ConfirmButton>
              </Card>
            </>
          )}
        </>
      )}

      <Modal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title="Import a week"
        subtitle="Xero → Reports → Inventory Item Details, set the delivery week's date range, then export."
      >
        <CsvUpload
          busy={importReport.isPending}
          accept=".xlsx,.xls,.csv"
          label="Drop the Inventory Item Details export here, or click to pick a file"
          hint="Xero .xlsx or .csv. Last week's box contents are carried over as a starting point so you only change what differs."
          onBinaryFile={(base64, fileName) => void doImport({ base64 }, fileName)}
          onFile={(csv, fileName) => void doImport({ csv }, fileName)}
        />
      </Modal>
    </div>
  );
}
