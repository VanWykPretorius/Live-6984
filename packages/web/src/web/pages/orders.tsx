import * as React from "react";
import { Link } from "wouter";
import {
  ChevronDown,
  ChevronRight,
  Download,
  RefreshCw,
  Trash2,
  TriangleAlert,
  Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import {
  Banner,
  Card,
  Chip,
  ConfirmButton,
  Empty,
  Loading,
  Modal,
  Money,
  PageHeader,
  Stat,
} from "@/components/ui/misc";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";
import { CsvUpload } from "@/components/csv-upload";
import { useToast } from "@/components/toast";
import {
  useImportOrders,
  useOrders,
  useRemoveOrder,
  useResolveLine,
  useSetOrderStatus,
  useSyncPrices,
  useUpdateLine,
} from "../queries/orders";
import { useProducts, useSetPrices } from "../queries/products";
import { useRunOrders } from "../queries/billing";
import { downloadCsv, errorMessage, money, shortDate } from "../lib/format";

type Filter = "pending" | "invoiced" | "ignored" | "all";

export default function Orders() {
  const toast = useToast();
  const [filter, setFilter] = React.useState<Filter>("pending");
  const [search, setSearch] = React.useState("");
  const [expanded, setExpanded] = React.useState<number[]>([]);
  const [selected, setSelected] = React.useState<number[]>([]);
  const [uploadOpen, setUploadOpen] = React.useState(false);

  const orders = useOrders(filter === "all" ? undefined : [filter]);
  const products = useProducts();
  const importOrders = useImportOrders();
  const resolveLine = useResolveLine();
  const updateLine = useUpdateLine();
  const syncPrices = useSyncPrices();
  const setStatus = useSetOrderStatus();
  const removeOrder = useRemoveOrder();
  const runOrders = useRunOrders();
  const setPrices = useSetPrices();
  const [draftPrices, setDraftPrices] = React.useState<Record<number, string>>({});

  const rows = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = orders.data ?? [];
    if (!q) return list;
    return list.filter(
      (o) =>
        o.orderNumber.toLowerCase().includes(q) ||
        (o.customer?.name ?? "").toLowerCase().includes(q) ||
        (o.customer?.company ?? "").toLowerCase().includes(q) ||
        (o.customer?.email ?? "").toLowerCase().includes(q),
    );
  }, [orders.data, search]);

  const billable = rows.filter(
    (o) => o.invoiceStatus === "pending" && o.unmatchedCount === 0 && o.missingPriceCount === 0,
  );
  /**
   * Selection follows the data, not the search box: an order that was invoiced, ignored or
   * deleted since it was ticked has to leave the selection, or Generate ships an id the
   * server then refuses the whole run over.
   */
  React.useEffect(() => {
    const list = orders.data;
    if (!list) return;
    setSelected((s) => {
      const next = s.filter((id) => list.some((o) => o.id === id && o.invoiceStatus === "pending"));
      return next.length === s.length ? s : next;
    });
  }, [orders.data]);

  const selectedRows = (orders.data ?? []).filter((o) => selected.includes(o.id));
  const selectedTotal = selectedRows.reduce((sum, o) => sum + o.computedTotal, 0);
  const blockedCount = rows.filter(
    (o) => o.invoiceStatus === "pending" && (o.unmatchedCount > 0 || o.missingPriceCount > 0),
  ).length;

  const toggle = (id: number) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));

  /**
   * Everything in the current selection that stops a CSV being generated, grouped so the
   * user can fix it in place instead of hunting through the catalog.
   */
  const blockers = React.useMemo(() => {
    const prices = new Map<
      number,
      { productId: number; sku: string; description: string; orders: string[] }
    >();
    const noProduct: { sku: string; description: string; orders: string[] }[] = [];
    const unmatched: { orderId: number; orderNumber: string; names: string[] }[] = [];
    const empty: string[] = [];

    for (const o of selectedRows) {
      if (o.invoiceStatus !== "pending") continue;
      const live = o.lines.filter((l) => l.status !== "ignored");
      if (live.length === 0) {
        empty.push(o.orderNumber);
        continue;
      }
      const names: string[] = [];
      for (const l of live) {
        if (l.status === "unmatched") {
          names.push(l.rawName || l.description);
          continue;
        }
        if (l.unitPrice !== null && l.unitPrice !== 0) continue;
        if (l.productId === null) {
          const hit = noProduct.find((n) => n.sku === (l.sku ?? ""));
          if (hit) {
            if (!hit.orders.includes(o.orderNumber)) hit.orders.push(o.orderNumber);
          } else {
            noProduct.push({
              sku: l.sku ?? "",
              description: l.description,
              orders: [o.orderNumber],
            });
          }
          continue;
        }
        const hit = prices.get(l.productId);
        if (hit) {
          if (!hit.orders.includes(o.orderNumber)) hit.orders.push(o.orderNumber);
        } else {
          prices.set(l.productId, {
            productId: l.productId,
            sku: l.sku || "no SKU",
            description: l.description,
            orders: [o.orderNumber],
          });
        }
      }
      if (names.length > 0) unmatched.push({ orderId: o.id, orderNumber: o.orderNumber, names });
    }

    const needPrice = [...prices.values()].sort((a, b) => a.sku.localeCompare(b.sku));
    return {
      needPrice,
      noProduct,
      unmatched,
      empty,
      count: needPrice.length + noProduct.length + unmatched.length + empty.length,
      readyIds: selectedRows
        .filter(
          (o) =>
            o.invoiceStatus === "pending" && o.unmatchedCount === 0 && o.missingPriceCount === 0,
        )
        .map((o) => o.id),
    };
  }, [selectedRows]);

  async function savePrices() {
    const payload = blockers.needPrice
      .map((p) => ({ id: p.productId, unitPrice: Number(draftPrices[p.productId]) }))
      .filter((p) => Number.isFinite(p.unitPrice) && p.unitPrice > 0);
    if (payload.length === 0) {
      toast.push("Enter a price for at least one SKU first.", "info");
      return;
    }
    try {
      const res = await setPrices.mutateAsync({ prices: payload });
      setDraftPrices({});
      toast.push(
        `${res.updated} SKU${res.updated === 1 ? "" : "s"} priced · ${res.linesFilled} order line${res.linesFilled === 1 ? "" : "s"} updated.`,
        "good",
      );
    } catch (err) {
      toast.push(errorMessage(err), "bad");
    }
  }

  async function handleImport(csv: string, fileName: string) {
    try {
      const res = await importOrders.mutateAsync({ csv });
      setUploadOpen(false);
      toast.push(
        `${fileName}: ${res.imported} imported, ${res.skipped} already present, ${res.productsCreated.length} new SKU${res.productsCreated.length === 1 ? "" : "s"}, ${res.unmatchedLines} line${res.unmatchedLines === 1 ? "" : "s"} need matching.`,
        res.unmatchedLines > 0 ? "info" : "good",
      );
    } catch (err) {
      toast.push(errorMessage(err), "bad");
    }
  }

  async function generate() {
    if (blockers.count > 0) {
      toast.push("Some selected orders aren't ready — see “Fix before generating” below.", "bad");
      setExpanded((e) => [...new Set([...e, ...blockers.unmatched.map((u) => u.orderId)])]);
      return;
    }
    try {
      const res = await runOrders.mutateAsync({ orderIds: selectedRows.map((o) => o.id) });
      downloadCsv(res.fileName, res.csv);
      setSelected([]);
      toast.push(`${res.invoiceCount} invoices · ${money(res.total)} — CSV downloaded.`, "good");
    } catch (err) {
      toast.push(errorMessage(err), "bad");
    }
  }

  return (
    <div>
      <PageHeader
        title="Website Orders"
        subtitle="Upload the WooCommerce order export. Each line is matched to a Xero SKU, then invoiced as a bulk CSV."
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link to="/billing">
                <Download className="size-3.5" />
                Combine with subscriptions
              </Link>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const res = await syncPrices.mutateAsync({});
                toast.push(`${res.updated} line prices refreshed from the catalog.`, "info");
              }}
              disabled={syncPrices.isPending}
            >
              <RefreshCw className="size-3.5" /> Sync prices
            </Button>
            <Button size="sm" onClick={() => setUploadOpen(true)}>
              <Upload className="size-3.5" /> Import CSV
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Pending"
          value={(orders.data ?? []).filter((o) => o.invoiceStatus === "pending").length}
        />
        <Stat
          label="Needs attention"
          value={blockedCount}
          tone={blockedCount > 0 ? "warn" : undefined}
          hint="unmatched lines or no price"
        />
        <Stat label="Ready to invoice" value={billable.length} tone="good" />
        <Stat
          label="Selected value"
          value={money(selectedTotal)}
          hint={`${selected.length} selected`}
        />
      </div>

      <div className="mt-6 mb-3 flex flex-wrap items-center gap-2">
        <Select
          className="w-40"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value as Filter);
            setSelected([]);
          }}
        >
          <option value="pending">Pending</option>
          <option value="invoiced">Invoiced</option>
          <option value="ignored">Ignored</option>
          <option value="all">All orders</option>
        </Select>
        <Input
          className="w-72"
          placeholder="Search order #, customer, email…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex-1" />
        {selected.length > 0 && (
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                await setStatus.mutateAsync({ orderIds: selected, invoiceStatus: "ignored" });
                setSelected([]);
                toast.push("Orders moved to ignored.", "info");
              }}
            >
              Ignore
            </Button>
            {blockers.count > 0 && blockers.readyIds.length > 0 && (
              <Button variant="outline" size="sm" onClick={() => setSelected(blockers.readyIds)}>
                Keep only ready ({blockers.readyIds.length})
              </Button>
            )}
            <Button
              size="sm"
              className="bg-accent text-accent-foreground hover:bg-accent/90"
              onClick={generate}
              disabled={runOrders.isPending || blockers.count > 0}
              title={
                blockers.count > 0
                  ? "Some selected orders still need prices or matching"
                  : undefined
              }
            >
              <Download className="size-3.5" /> Generate Xero CSV ({selected.length})
            </Button>
          </>
        )}
        {selected.length === 0 && billable.length > 0 && filter === "pending" && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setSelected(billable.map((o) => o.id))}
          >
            Select all ready ({billable.length})
          </Button>
        )}
      </div>

      {blockers.count > 0 && (
        <Card className="mb-3 border-warning/40 bg-warning/[0.06] p-3">
          <div className="flex items-center gap-2 text-[13px] font-semibold text-warning">
            <TriangleAlert className="size-4" />
            Fix before generating
          </div>
          <p className="mt-1 text-[12px] text-muted-foreground">
            Xero rejects a zero-priced or unmatched line, so the CSV is held back until every
            selected order is complete.
          </p>

          {blockers.needPrice.length > 0 && (
            <div className="mt-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {blockers.needPrice.length} SKU{blockers.needPrice.length === 1 ? "" : "s"} need a
                catalog price
              </div>
              <div className="mt-1.5 space-y-1.5">
                {blockers.needPrice.map((p) => (
                  <div
                    key={p.productId}
                    className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5"
                  >
                    <span className="num w-24 shrink-0 text-[11px] font-semibold text-accent">
                      {p.sku}
                    </span>
                    <span className="min-w-[200px] flex-1 text-[12px]">{p.description}</span>
                    <span className="text-[11px] text-muted-foreground">
                      on #{p.orders.join(", #")}
                    </span>
                    <Input
                      className="h-7 w-24 text-[12px]"
                      type="number"
                      step="0.01"
                      placeholder="price"
                      value={draftPrices[p.productId] ?? ""}
                      onChange={(e) =>
                        setDraftPrices((d) => ({ ...d, [p.productId]: e.target.value }))
                      }
                    />
                  </div>
                ))}
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Button size="sm" onClick={savePrices} disabled={setPrices.isPending}>
                  Save prices & unblock
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  Saved to the catalog, then copied onto every pending order line still blank.
                </span>
              </div>
            </div>
          )}

          {blockers.noProduct.length > 0 && (
            <div className="mt-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {blockers.noProduct.length} line
                {blockers.noProduct.length === 1 ? "" : "s"} not linked to a catalog product
              </div>
              <div className="mt-1 text-[12px] text-muted-foreground">
                {blockers.noProduct.map((n) => (
                  <div key={`${n.sku}-${n.description}`}>
                    {n.sku || "no SKU"} — {n.description}{" "}
                    <span className="text-[11px]">(on #{n.orders.join(", #")})</span>
                  </div>
                ))}
                Expand the order below and type a price on the line, or match it to a product.
              </div>
            </div>
          )}

          {blockers.unmatched.length > 0 && (
            <div className="mt-3">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {blockers.unmatched.reduce((n, u) => n + u.names.length, 0)} line
                {blockers.unmatched.reduce((n, u) => n + u.names.length, 0) === 1 ? "" : "s"} need
                matching to a SKU
              </div>
              <div className="mt-1.5 space-y-1.5">
                {blockers.unmatched.map((u) => (
                  <div
                    key={u.orderId}
                    className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5"
                  >
                    <span className="num text-[12px] font-semibold">#{u.orderNumber}</span>
                    <span className="min-w-[200px] flex-1 text-[12px] text-muted-foreground">
                      {u.names.join(", ")}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() =>
                        setExpanded((e) => (e.includes(u.orderId) ? e : [...e, u.orderId]))
                      }
                    >
                      Match lines
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {blockers.empty.length > 0 && (
            <div className="mt-3 text-[12px] text-muted-foreground">
              Every line is ignored on #{blockers.empty.join(", #")} — restore a line or deselect
              the order.
            </div>
          )}
        </Card>
      )}

      <Card className="overflow-hidden">
        {orders.isLoading ? (
          <Loading label="Loading orders" />
        ) : rows.length === 0 ? (
          <Empty
            title="No orders here"
            hint="Import a WooCommerce order export to get started — the CSV with the Items column."
          />
        ) : (
          <Table>
            <THead>
              <TH className="w-8" />
              <TH className="w-8" />
              <TH>Order</TH>
              <TH>Date</TH>
              <TH>Customer</TH>
              <TH align="center">Items</TH>
              <TH align="right">Website total</TH>
              <TH align="right">Invoice total</TH>
              <TH>Status</TH>
              <TH className="w-8" />
            </THead>
            <tbody>
              {rows.map((o) => {
                const open = expanded.includes(o.id);
                const blocked = o.unmatchedCount > 0 || o.missingPriceCount > 0;
                return (
                  <React.Fragment key={o.id}>
                    <TR>
                      <TD>
                        {o.invoiceStatus === "pending" && (
                          <input
                            type="checkbox"
                            aria-label={`Select order ${o.orderNumber}`}
                            className="size-3.5 accent-[var(--accent)]"
                            checked={selected.includes(o.id)}
                            onChange={() => toggle(o.id)}
                          />
                        )}
                      </TD>
                      <TD>
                        <button
                          type="button"
                          onClick={() =>
                            setExpanded((e) =>
                              e.includes(o.id) ? e.filter((x) => x !== o.id) : [...e, o.id],
                            )
                          }
                          className="text-muted-foreground hover:text-primary"
                        >
                          {open ? (
                            <ChevronDown className="size-4" />
                          ) : (
                            <ChevronRight className="size-4" />
                          )}
                        </button>
                      </TD>
                      <TD className="font-semibold num">#{o.orderNumber}</TD>
                      <TD className="whitespace-nowrap text-muted-foreground">
                        {shortDate(o.orderDate)}
                      </TD>
                      <TD>
                        <div className="font-medium">{o.customer?.name ?? "—"}</div>
                        {o.customer?.company && (
                          <div className="text-[11px] text-muted-foreground">
                            {o.customer.company}
                          </div>
                        )}
                      </TD>
                      <TD align="center">{o.lines.length}</TD>
                      <TD align="right">
                        <Money value={o.orderTotal} />
                      </TD>
                      <TD align="right">
                        <Money
                          value={o.computedTotal}
                          className={o.totalMismatch ? "text-warning font-semibold" : ""}
                        />
                      </TD>
                      <TD>
                        <div className="flex flex-wrap items-center gap-1">
                          {o.invoiceStatus === "invoiced" ? (
                            <Chip tone="good">{o.invoiceNumber ?? "invoiced"}</Chip>
                          ) : o.invoiceStatus === "ignored" ? (
                            <Chip>ignored</Chip>
                          ) : blocked ? (
                            <Chip tone="warn">
                              <TriangleAlert className="size-3" />
                              {o.unmatchedCount > 0
                                ? `${o.unmatchedCount} unmatched`
                                : `${o.missingPriceCount} no price`}
                            </Chip>
                          ) : (
                            <Chip tone="info">ready</Chip>
                          )}
                          {o.totalMismatch && o.invoiceStatus === "pending" && (
                            <Chip tone="warn">total differs</Chip>
                          )}
                        </div>
                      </TD>
                      <TD>
                        <ConfirmButton
                          title="Delete order"
                          onConfirm={async () => {
                            try {
                              await removeOrder.mutateAsync({ id: o.id });
                              toast.push(`Order #${o.orderNumber} deleted.`, "info");
                            } catch (err) {
                              toast.push(errorMessage(err), "bad");
                            }
                          }}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="size-3.5" />
                        </ConfirmButton>
                      </TD>
                    </TR>
                    {open && (
                      <TR className="bg-muted/35">
                        <TD colSpan={10} className="px-3 py-3">
                          <div className="space-y-1.5">
                            {o.lines.map((l) => {
                              const needsPrice =
                                l.status === "matched" &&
                                (l.unitPrice === null || l.unitPrice === 0);
                              return (
                                <div
                                  key={l.id}
                                  className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5"
                                >
                                  <span className="num w-24 shrink-0 text-[11px] font-semibold text-accent">
                                    {l.sku || "no SKU"}
                                  </span>
                                  <span className="min-w-[220px] flex-1 text-[12px]">
                                    {l.description}
                                    {l.rawName !== l.description && (
                                      <span className="ml-1 text-muted-foreground">
                                        ({l.rawName})
                                      </span>
                                    )}
                                  </span>
                                  <span className="num text-[12px] text-muted-foreground">
                                    ×{l.quantity}
                                  </span>
                                  <Input
                                    className="h-7 w-24 text-[12px]"
                                    type="number"
                                    step="0.01"
                                    defaultValue={l.unitPrice ?? ""}
                                    placeholder="price"
                                    onBlur={async (e) => {
                                      const v = e.target.value;
                                      const next = v === "" ? null : Number(v);
                                      if (next === l.unitPrice) return;
                                      await updateLine.mutateAsync({
                                        lineId: l.id,
                                        unitPrice: next,
                                      });
                                    }}
                                  />
                                  {l.status === "unmatched" ? (
                                    <Select
                                      className="h-7 w-64 text-[12px]"
                                      defaultValue=""
                                      onChange={async (e) => {
                                        const productId = Number(e.target.value);
                                        if (!productId) return;
                                        await resolveLine.mutateAsync({
                                          lineId: l.id,
                                          productId,
                                          rememberAlias: true,
                                        });
                                        toast.push(
                                          "Line matched — the name is remembered for next time.",
                                          "good",
                                        );
                                      }}
                                    >
                                      <option value="">Match to a product…</option>
                                      {(products.data ?? []).map((p) => (
                                        <option key={p.id} value={p.id}>
                                          {p.sku} — {p.description}
                                        </option>
                                      ))}
                                    </Select>
                                  ) : needsPrice ? (
                                    <Chip tone="warn">needs price</Chip>
                                  ) : l.status === "ignored" ? (
                                    <Chip>ignored</Chip>
                                  ) : (
                                    <Chip tone="good">matched</Chip>
                                  )}
                                  <button
                                    type="button"
                                    className="text-[11px] font-semibold text-muted-foreground hover:text-primary"
                                    onClick={() =>
                                      updateLine.mutate({
                                        lineId: l.id,
                                        status: l.status === "ignored" ? "matched" : "ignored",
                                      })
                                    }
                                  >
                                    {l.status === "ignored" ? "restore" : "ignore"}
                                  </button>
                                </div>
                              );
                            })}
                            {o.rawItems && (
                              <div className="pt-1 text-[11px] leading-relaxed text-muted-foreground">
                                <span className="font-semibold">Raw: </span>
                                {o.rawItems}
                              </div>
                            )}
                            {o.customerNote && (
                              <div className="text-[11px] text-muted-foreground">
                                <span className="font-semibold">Note: </span>
                                {o.customerNote}
                              </div>
                            )}
                          </div>
                        </TD>
                      </TR>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title="Import WooCommerce orders"
        subtitle="The order export CSV — Order Number, Billing details, Items, totals."
      >
        <CsvUpload
          busy={importOrders.isPending}
          onFile={handleImport}
          label="Drop the order export here, or click to pick a file"
          hint="Orders already imported are skipped. Unknown SKUs are added to the catalog as drafts so you can price them."
        />
        <div className="mt-3">
          <Banner tone="info">
            Items without a SKU on the website get matched by hand once — after that the name is
            remembered automatically.
          </Banner>
        </div>
      </Modal>
    </div>
  );
}
