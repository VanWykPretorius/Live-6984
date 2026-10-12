import * as React from "react";
import {
  CalendarClock,
  FileSpreadsheet,
  History,
  Pause,
  Pencil,
  Play,
  Plus,
  Trash2,
  X,
} from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/input";
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
import { useToast } from "@/components/toast";
import {
  useCancelSubscription,
  useCreateSubscription,
  usePauseSubscription,
  useRemoveSubscription,
  useResumeSubscription,
  useSkipDelivery,
  useSubscriptionDeliveries,
  useSubscriptions,
  useUnskipDelivery,
  useUpdateSubscription,
} from "../queries/subscriptions";
import { useCustomers } from "../queries/customers";
import { useProducts } from "../queries/products";
import { useSettings } from "../queries/settings";
import { addDays, dayName, errorMessage, money, shortDate, todayIso } from "../lib/format";

type AddonDraft = { productId: number; quantity: string; unitPrice: string };

type Draft = {
  id?: number;
  customerId: string;
  boxProductId: string;
  boxPrice: string;
  boxQuantity: string;
  frequency: "weekly" | "biweekly";
  startDate: string;
  includeShipping: boolean;
  shippingAmount: string;
  reference: string;
  notes: string;
  addons: AddonDraft[];
};

export default function Subscriptions() {
  const toast = useToast();
  const subs = useSubscriptions();
  const customers = useCustomers();
  const products = useProducts();
  const settings = useSettings();

  const create = useCreateSubscription();
  const update = useUpdateSubscription();
  const pause = usePauseSubscription();
  const resume = useResumeSubscription();
  const cancel = useCancelSubscription();
  const remove = useRemoveSubscription();
  const skip = useSkipDelivery();
  const unskip = useUnskipDelivery();

  const [statusFilter, setStatusFilter] = React.useState<"active" | "paused" | "cancelled" | "all">(
    "active",
  );
  const [search, setSearch] = React.useState("");
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [pauseFor, setPauseFor] = React.useState<{ id: number; name: string } | null>(null);
  const [pauseRange, setPauseRange] = React.useState({
    from: todayIso(),
    to: addDays(todayIso(), 14),
  });
  const [historyFor, setHistoryFor] = React.useState<number | null>(null);

  const history = useSubscriptionDeliveries(historyFor);
  const historySub = (subs.data ?? []).find((s) => s.id === historyFor) ?? null;

  const boxOptions = (products.data ?? []).filter((p) => p.kind === "box" || p.kind === "product");
  const addonOptions = (products.data ?? []).filter((p) => p.active && p.kind !== "shipping");

  const rows = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = subs.data ?? [];
    if (statusFilter !== "all") list = list.filter((s) => s.status === statusFilter);
    if (!q) return list;
    return list.filter((s) =>
      [s.customer.name, s.customer.company, s.reference].some((v) =>
        (v ?? "").toLowerCase().includes(q),
      ),
    );
  }, [subs.data, statusFilter, search]);

  function newDraft(): Draft {
    const s = settings.data;
    const defaultBox = boxOptions.find(
      (p) => s?.defaultBoxSku && p.sku === s.defaultBoxSku.toUpperCase(),
    );
    return {
      customerId: "",
      boxProductId: defaultBox ? String(defaultBox.id) : "",
      boxPrice: String(s?.defaultBoxPrice ?? 200),
      boxQuantity: "1",
      frequency: "weekly",
      startDate: todayIso(),
      includeShipping: false,
      shippingAmount: String(s?.defaultShippingAmount ?? 0),
      reference: "",
      notes: "",
      addons: [],
    };
  }

  function draftFrom(s: NonNullable<typeof subs.data>[number]): Draft {
    return {
      id: s.id,
      customerId: String(s.customerId),
      boxProductId: s.boxProductId ? String(s.boxProductId) : "",
      boxPrice: String(s.boxPrice),
      boxQuantity: String(s.boxQuantity),
      frequency: s.frequency as "weekly" | "biweekly",
      startDate: s.startDate,
      includeShipping: s.includeShipping,
      shippingAmount: String(s.shippingAmount),
      reference: s.reference ?? "",
      notes: s.notes ?? "",
      addons: s.addons.map((a) => ({
        productId: a.productId,
        quantity: String(a.quantity),
        unitPrice: a.unitPrice === null ? "" : String(a.unitPrice),
      })),
    };
  }

  const draftTotal = React.useMemo(() => {
    if (!draft) return 0;
    const box = Number(draft.boxPrice || 0) * Number(draft.boxQuantity || 0);
    const addons = draft.addons.reduce((sum, a) => {
      const product = addonOptions.find((p) => p.id === a.productId);
      const price = a.unitPrice === "" ? (product?.unitPrice ?? 0) : Number(a.unitPrice);
      return sum + price * Number(a.quantity || 0);
    }, 0);
    const ship = draft.includeShipping ? Number(draft.shippingAmount || 0) : 0;
    return Math.round((box + addons + ship) * 100) / 100;
  }, [draft, addonOptions]);

  async function save() {
    if (!draft) return;
    if (!draft.customerId) {
      toast.push("Pick a customer first.", "bad");
      return;
    }
    const values = {
      customerId: Number(draft.customerId),
      boxProductId: draft.boxProductId ? Number(draft.boxProductId) : null,
      boxPrice: Number(draft.boxPrice || 0),
      boxQuantity: Number(draft.boxQuantity || 1),
      frequency: draft.frequency,
      startDate: draft.startDate,
      includeShipping: draft.includeShipping,
      shippingAmount: Number(draft.shippingAmount || 0),
      reference: draft.reference.trim() || null,
      notes: draft.notes.trim() || null,
      addons: draft.addons
        .filter((a) => a.productId)
        .map((a) => ({
          productId: a.productId,
          quantity: Number(a.quantity || 1),
          unitPrice: a.unitPrice === "" ? null : Number(a.unitPrice),
        })),
    };
    try {
      if (draft.id) await update.mutateAsync({ id: draft.id, ...values });
      else await create.mutateAsync(values);
      setDraft(null);
      toast.push("Subscription saved.", "good");
    } catch (err) {
      toast.push(errorMessage(err), "bad");
    }
  }

  const stats = {
    active: (subs.data ?? []).filter((s) => s.status === "active").length,
    paused: (subs.data ?? []).filter((s) => s.status === "paused").length,
    weekly:
      Math.round(
        (subs.data ?? [])
          .filter((s) => s.status === "active")
          .reduce((sum, s) => sum + s.perDelivery / (s.frequency === "biweekly" ? 2 : 1), 0) * 100,
      ) / 100,
    blocked: (subs.data ?? []).filter(
      (s) =>
        s.status !== "cancelled" && (s.boxPrice === 0 || s.addons.some((a) => !a.effectivePrice)),
    ).length,
  };

  return (
    <div>
      <PageHeader
        title="Subscriptions"
        subtitle="Vegetable boxes billed per delivery. Add-ons are normal Xero SKUs, and a pause simply removes the deliveries in that window."
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link to="/billing">
                <FileSpreadsheet className="size-3.5" />
                Invoice in Xero
              </Link>
            </Button>
            <Button size="sm" onClick={() => setDraft(newDraft())}>
              <Plus className="size-3.5" /> New subscription
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Active" value={stats.active} tone="good" />
        <Stat label="Paused" value={stats.paused} tone={stats.paused > 0 ? "warn" : undefined} />
        <Stat label="Average per week" value={money(stats.weekly)} hint="across active boxes" />
        <Stat
          label="Blocked on pricing"
          value={stats.blocked}
          tone={stats.blocked > 0 ? "bad" : undefined}
        />
      </div>

      <div className="mt-6 mb-3 flex flex-wrap items-center gap-2">
        <Select
          className="w-40"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
        >
          <option value="active">Active</option>
          <option value="paused">Paused</option>
          <option value="cancelled">Cancelled</option>
          <option value="all">All</option>
        </Select>
        <Input
          className="w-72"
          placeholder="Search customer or reference…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card className="overflow-hidden">
        {subs.isLoading ? (
          <Loading label="Loading subscriptions" />
        ) : rows.length === 0 ? (
          <Empty
            title="No subscriptions here"
            hint="Add a box subscriber — pick the customer, the box SKU, the frequency and any add-ons."
          />
        ) : (
          <Table>
            <THead>
              <TH>Customer</TH>
              <TH>Box</TH>
              <TH>Add-ons</TH>
              <TH>Frequency</TH>
              <TH>Next delivery</TH>
              <TH align="right">Per delivery</TH>
              <TH align="center">Billed</TH>
              <TH>Status</TH>
              <TH className="w-32" />
            </THead>
            <tbody>
              {rows.map((s) => {
                const priceGap = s.addons.some((a) => !a.effectivePrice) || s.boxPrice === 0;
                return (
                  <TR key={s.id}>
                    <TD>
                      <div className="font-medium">{s.customer.name}</div>
                      {s.customer.company && (
                        <div className="text-[11px] text-muted-foreground">
                          {s.customer.company}
                        </div>
                      )}
                    </TD>
                    <TD>
                      <div className="num text-[11px] font-semibold text-accent">
                        {s.box?.sku ?? "no SKU"}
                      </div>
                      <div className="text-[12px] text-muted-foreground">
                        {s.boxQuantity} × {money(s.boxPrice)}
                      </div>
                    </TD>
                    <TD className="max-w-[240px]">
                      {s.addons.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          {s.addons.map((a) => (
                            <Chip key={a.id} tone={a.effectivePrice ? "neutral" : "warn"}>
                              {a.sku || a.description} ×{a.quantity}
                            </Chip>
                          ))}
                        </div>
                      )}
                    </TD>
                    <TD>
                      <Chip tone="info">{s.frequency === "biweekly" ? "2-weekly" : "weekly"}</Chip>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        from {shortDate(s.startDate)}
                      </div>
                    </TD>
                    <TD className="whitespace-nowrap">
                      {s.nextDelivery ? (
                        <>
                          <div className="font-medium">{shortDate(s.nextDelivery)}</div>
                          <div className="text-[11px] text-muted-foreground">
                            {dayName(s.nextDelivery)}
                          </div>
                        </>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TD>
                    <TD align="right">
                      <Money value={s.perDelivery} className={priceGap ? "text-warning" : ""} />
                      {s.includeShipping && (
                        <div className="text-[11px] text-muted-foreground">
                          incl. {money(s.shippingAmount)} delivery
                        </div>
                      )}
                    </TD>
                    <TD align="center">
                      <button
                        type="button"
                        onClick={() => setHistoryFor(s.id)}
                        className="num font-semibold text-accent hover:underline"
                      >
                        {s.deliveriesBilled}
                      </button>
                    </TD>
                    <TD>
                      {s.status === "active" ? (
                        <Chip tone="good">active</Chip>
                      ) : s.status === "paused" ? (
                        <Chip tone="warn">
                          paused
                          {s.pauseTo ? ` → ${shortDate(s.pauseTo)}` : ""}
                        </Chip>
                      ) : (
                        <Chip>cancelled</Chip>
                      )}
                      {priceGap && s.status !== "cancelled" && (
                        <Chip tone="bad" className="ml-1">
                          no price
                        </Chip>
                      )}
                    </TD>
                    <TD>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          title="Edit"
                          onClick={() => setDraft(draftFrom(s))}
                          className="text-muted-foreground hover:text-primary"
                        >
                          <Pencil className="size-3.5" />
                        </button>
                        <button
                          type="button"
                          title="Delivery history"
                          onClick={() => setHistoryFor(s.id)}
                          className="text-muted-foreground hover:text-primary"
                        >
                          <History className="size-3.5" />
                        </button>
                        {s.status === "active" ? (
                          <button
                            type="button"
                            title="Pause"
                            onClick={() => {
                              setPauseFor({ id: s.id, name: s.customer.name });
                              setPauseRange({ from: todayIso(), to: addDays(todayIso(), 14) });
                            }}
                            className="text-muted-foreground hover:text-warning"
                          >
                            <Pause className="size-3.5" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            title="Resume"
                            onClick={async () => {
                              await resume.mutateAsync({ id: s.id });
                              toast.push(`${s.customer.name} resumed.`, "good");
                            }}
                            className="text-muted-foreground hover:text-leaf"
                          >
                            <Play className="size-3.5" />
                          </button>
                        )}
                        {s.status !== "cancelled" && (
                          <button
                            type="button"
                            title="Cancel subscription"
                            onClick={async () => {
                              await cancel.mutateAsync({ id: s.id });
                              toast.push(`${s.customer.name} cancelled.`, "info");
                            }}
                            className="text-muted-foreground hover:text-destructive"
                          >
                            <X className="size-3.5" />
                          </button>
                        )}
                        <ConfirmButton
                          title="Delete (also removes billing history)"
                          onConfirm={async () => {
                            try {
                              await remove.mutateAsync({ id: s.id });
                              toast.push("Subscription deleted.", "info");
                            } catch (err) {
                              toast.push(errorMessage(err), "bad");
                            }
                          }}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="size-3.5" />
                        </ConfirmButton>
                      </div>
                    </TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {/* Create / edit */}
      <Modal
        open={draft !== null}
        onClose={() => setDraft(null)}
        wide
        title={draft?.id ? "Edit subscription" : "New subscription"}
        subtitle="Boxes are invoiced per delivery, so the frequency and start date decide what the billing run picks up."
        footer={
          <>
            <div className="mr-auto text-[12px] text-muted-foreground">
              Per delivery:{" "}
              <span className="num font-semibold text-primary">{money(draftTotal)}</span>
            </div>
            <Button variant="outline" size="sm" onClick={() => setDraft(null)}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={create.isPending || update.isPending}>
              Save
            </Button>
          </>
        }
      >
        {draft && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3">
              <Field label="Customer" className="col-span-2">
                <Select
                  value={draft.customerId}
                  onChange={(e) => setDraft({ ...draft, customerId: e.target.value })}
                >
                  <option value="">Pick a customer…</option>
                  {(customers.data ?? []).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.company ? ` — ${c.company}` : ""}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Reference" hint="Shows on the Xero invoice.">
                <Input
                  value={draft.reference}
                  onChange={(e) => setDraft({ ...draft, reference: e.target.value })}
                  placeholder="Box subscription"
                />
              </Field>
              <Field label="Box SKU">
                <Select
                  value={draft.boxProductId}
                  onChange={(e) => {
                    const product = boxOptions.find((p) => String(p.id) === e.target.value);
                    setDraft({
                      ...draft,
                      boxProductId: e.target.value,
                      boxPrice:
                        product?.unitPrice != null ? String(product.unitPrice) : draft.boxPrice,
                    });
                  }}
                >
                  <option value="">No box SKU</option>
                  {boxOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.sku} — {p.description}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Box price">
                <Input
                  type="number"
                  step="0.01"
                  value={draft.boxPrice}
                  onChange={(e) => setDraft({ ...draft, boxPrice: e.target.value })}
                />
              </Field>
              <Field label="Boxes per delivery">
                <Input
                  type="number"
                  step="1"
                  min="1"
                  value={draft.boxQuantity}
                  onChange={(e) => setDraft({ ...draft, boxQuantity: e.target.value })}
                />
              </Field>
              <Field label="Frequency">
                <Select
                  value={draft.frequency}
                  onChange={(e) =>
                    setDraft({ ...draft, frequency: e.target.value as "weekly" | "biweekly" })
                  }
                >
                  <option value="weekly">Every week</option>
                  <option value="biweekly">Every 2 weeks</option>
                </Select>
              </Field>
              <Field label="First delivery" hint="Every delivery date is counted from this day.">
                <Input
                  type="date"
                  value={draft.startDate}
                  onChange={(e) => setDraft({ ...draft, startDate: e.target.value })}
                />
              </Field>
              <Field label="Delivery fee">
                <div className="flex items-center gap-2">
                  <Select
                    className="w-24"
                    value={draft.includeShipping ? "yes" : "no"}
                    onChange={(e) =>
                      setDraft({ ...draft, includeShipping: e.target.value === "yes" })
                    }
                  >
                    <option value="no">No</option>
                    <option value="yes">Yes</option>
                  </Select>
                  <Input
                    type="number"
                    step="0.01"
                    disabled={!draft.includeShipping}
                    value={draft.shippingAmount}
                    onChange={(e) => setDraft({ ...draft, shippingAmount: e.target.value })}
                  />
                </div>
              </Field>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Add-ons on every delivery
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setDraft({
                      ...draft,
                      addons: [
                        ...draft.addons,
                        { productId: addonOptions[0]?.id ?? 0, quantity: "1", unitPrice: "" },
                      ],
                    })
                  }
                >
                  <Plus className="size-3.5" /> Add-on
                </Button>
              </div>
              {draft.addons.length === 0 ? (
                <div className="rounded-md border border-dashed border-border px-3 py-4 text-center text-[12px] text-muted-foreground">
                  No add-ons. The invoice will hold the box line only.
                </div>
              ) : (
                <div className="space-y-2">
                  {draft.addons.map((a, i) => {
                    const product = addonOptions.find((p) => p.id === a.productId);
                    return (
                      <div key={i} className="flex flex-wrap items-end gap-2">
                        <Select
                          className="min-w-[260px] flex-1"
                          value={String(a.productId)}
                          onChange={(e) => {
                            const next = [...draft.addons];
                            next[i] = { ...a, productId: Number(e.target.value) };
                            setDraft({ ...draft, addons: next });
                          }}
                        >
                          {addonOptions.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.sku} — {p.description}
                            </option>
                          ))}
                        </Select>
                        <Input
                          className="w-20"
                          type="number"
                          step="0.01"
                          value={a.quantity}
                          onChange={(e) => {
                            const next = [...draft.addons];
                            next[i] = { ...a, quantity: e.target.value };
                            setDraft({ ...draft, addons: next });
                          }}
                        />
                        <Input
                          className="w-28"
                          type="number"
                          step="0.01"
                          placeholder={
                            product?.unitPrice != null ? String(product.unitPrice) : "no price"
                          }
                          value={a.unitPrice}
                          onChange={(e) => {
                            const next = [...draft.addons];
                            next[i] = { ...a, unitPrice: e.target.value };
                            setDraft({ ...draft, addons: next });
                          }}
                        />
                        <button
                          type="button"
                          onClick={() =>
                            setDraft({
                              ...draft,
                              addons: draft.addons.filter((_, j) => j !== i),
                            })
                          }
                          className="mb-2 text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    );
                  })}
                  <div className="text-[11px] text-muted-foreground">
                    Leave the price blank to always use the catalog price.
                  </div>
                </div>
              )}
            </div>

            <Field label="Notes">
              <Textarea
                rows={2}
                value={draft.notes}
                onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
                placeholder="Gate code, delivery instructions, anything internal."
              />
            </Field>
          </div>
        )}
      </Modal>

      {/* Pause */}
      <Modal
        open={pauseFor !== null}
        onClose={() => setPauseFor(null)}
        title={`Pause ${pauseFor?.name ?? ""}`}
        subtitle="No deliveries in this window get billed. Leave the end date blank to pause indefinitely."
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setPauseFor(null)}>
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={pause.isPending}
              onClick={async () => {
                if (!pauseFor) return;
                await pause.mutateAsync({
                  id: pauseFor.id,
                  pauseFrom: pauseRange.from || null,
                  pauseTo: pauseRange.to || null,
                });
                setPauseFor(null);
                toast.push("Subscription paused.", "info");
              }}
            >
              Pause
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-2 gap-3">
          <Field label="Pause from">
            <Input
              type="date"
              value={pauseRange.from}
              onChange={(e) => setPauseRange({ ...pauseRange, from: e.target.value })}
            />
          </Field>
          <Field label="Resume on">
            <Input
              type="date"
              value={pauseRange.to}
              onChange={(e) => setPauseRange({ ...pauseRange, to: e.target.value })}
            />
          </Field>
        </div>
      </Modal>

      {/* History */}
      <Modal
        open={historyFor !== null}
        onClose={() => setHistoryFor(null)}
        wide
        title={`Deliveries — ${historySub?.customer.name ?? ""}`}
        subtitle="Billed deliveries can never be billed twice. Skip an upcoming one to leave it out of the next run."
      >
        <div className="space-y-5">
          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              Upcoming
            </div>
            {historySub && historySub.upcoming.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {historySub.upcoming.map((d) => {
                  const existing = (history.data ?? []).find((x) => x.deliveryDate === d);
                  return (
                    <div
                      key={d}
                      className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 text-[12px]"
                    >
                      <CalendarClock className="size-3.5 text-accent" />
                      <span className="num font-medium">{shortDate(d)}</span>
                      {existing?.status === "skipped" ? (
                        <>
                          <Chip tone="warn">skipped</Chip>
                          <button
                            type="button"
                            className="text-[11px] font-semibold text-accent hover:underline"
                            onClick={() => unskip.mutate({ deliveryId: existing.id })}
                          >
                            restore
                          </button>
                        </>
                      ) : existing ? (
                        <Chip tone="good">{existing.invoiceNumber || "invoiced"}</Chip>
                      ) : (
                        <button
                          type="button"
                          className="text-[11px] font-semibold text-muted-foreground hover:text-destructive"
                          onClick={() =>
                            historyFor &&
                            skip.mutate({ subscriptionId: historyFor, deliveryDate: d })
                          }
                        >
                          skip
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <Banner tone="warn">
                No upcoming deliveries — the subscription is paused or cancelled.
              </Banner>
            )}
          </div>

          <div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              History
            </div>
            {history.isLoading ? (
              <Loading label="Loading history" />
            ) : (history.data ?? []).length === 0 ? (
              <Empty title="Nothing billed yet" />
            ) : (
              <Table>
                <THead>
                  <TH>Delivery date</TH>
                  <TH>Invoice</TH>
                  <TH align="right">Total</TH>
                  <TH>Status</TH>
                  <TH align="center">Batch</TH>
                </THead>
                <tbody>
                  {(history.data ?? []).map((d) => (
                    <TR key={d.id}>
                      <TD className="num">{shortDate(d.deliveryDate)}</TD>
                      <TD className="num">{d.invoiceNumber || "—"}</TD>
                      <TD align="right">
                        <Money value={d.total} />
                      </TD>
                      <TD>
                        {d.status === "skipped" ? (
                          <Chip tone="warn">skipped</Chip>
                        ) : (
                          <Chip tone="good">invoiced</Chip>
                        )}
                      </TD>
                      <TD align="center" className="num text-muted-foreground">
                        {d.batchId ?? "—"}
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            )}
          </div>
        </div>
      </Modal>
    </div>
  );
}
