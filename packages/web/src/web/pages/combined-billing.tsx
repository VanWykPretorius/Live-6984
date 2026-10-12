import { useEffect, useRef, useState } from "react";
import { Link } from "wouter";
import { ArrowRight, CalendarRange, Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import {
  Banner,
  Card,
  Chip,
  Empty,
  Loading,
  Modal,
  Money,
  PageHeader,
  Stat,
} from "@/components/ui/misc";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/toast";
import {
  useCombinedOptions,
  useCombinedPreview,
  useDefaultRange,
  useRunCombined,
} from "@/queries/billing";
import {
  addDays,
  downloadCsv,
  errorMessage,
  money,
  shortDate,
  todayIso,
  weekRange,
} from "@/lib/format";

type Source = NonNullable<ReturnType<typeof useCombinedOptions>["data"]>["sources"][number];
type Selection = Parameters<ReturnType<typeof useCombinedPreview>["mutateAsync"]>[0];
type Review = Awaited<ReturnType<ReturnType<typeof useCombinedPreview>["mutateAsync"]>>;

export default function CombinedBilling() {
  const toast = useToast();
  const defaults = useDefaultRange();
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [invoiceDate, setInvoiceDate] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [review, setReview] = useState<{ input: Selection; result: Review } | null>(null);
  const initialized = useRef("");
  const reviewRequest = useRef(0);
  const from = range?.from ?? "";
  const to = range?.to ?? "";
  const options = useCombinedOptions(from, to);
  const preview = useCombinedPreview();
  const run = useRunCombined();

  useEffect(() => {
    if (!range && defaults.data) setRange({ from: defaults.data.from, to: defaults.data.to });
  }, [range, defaults.data]);
  useEffect(() => {
    if (from) setInvoiceDate(addDays(weekRange(from).from, 3));
  }, [from]);
  useEffect(() => {
    reviewRequest.current++;
  }, [from, to, invoiceDate, selected]);
  useEffect(() => {
    if (!options.data) return;
    const ready = new Set(options.data.sources.filter((s) => !s.blocked.length).map((s) => s.key));
    const period = `${from}:${to}`;
    const firstLoad = initialized.current !== period;
    setSelected((previous) =>
      firstLoad ? ready : new Set([...previous].filter((key) => ready.has(key))),
    );
    initialized.current = period;
  }, [options.data, from, to]);

  const sources = options.data?.sources ?? [];
  const chosen = sources.filter((s) => selected.has(s.key) && !s.blocked.length);
  const invoiceCount = new Set(chosen.map((s) => s.customerKey)).size;
  const total = chosen.reduce((sum, s) => sum + s.total, 0);
  const blocked = sources.filter((s) => s.blocked.length);
  const deliveries = sources.filter((s) => s.type === "delivery");
  const orders = sources.filter((s) => s.type === "order");
  const dueDate = invoiceDate && options.data ? addDays(invoiceDate, options.data.dueDays) : "";
  const validPeriod = Boolean(
    from && to && from <= to && Date.parse(to) - Date.parse(from) <= 366 * 86400000,
  );

  function toggle(key: string) {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function toggleAll(rows: Source[]) {
    const ready = rows.filter((s) => !s.blocked.length);
    const all = ready.every((s) => selected.has(s.key));
    setSelected((previous) => {
      const next = new Set(previous);
      ready.forEach((s) => (all ? next.delete(s.key) : next.add(s.key)));
      return next;
    });
  }
  async function reviewInvoices() {
    const requestId = ++reviewRequest.current;
    const input: Selection = {
      from,
      to,
      invoiceDate,
      orderIds: chosen.filter((s) => s.type === "order").map((s) => s.orderId!),
      deliveries: chosen
        .filter((s) => s.type === "delivery")
        .map((s) => ({ subscriptionId: s.subscriptionId!, deliveryDate: s.date })),
    };
    try {
      const result = await preview.mutateAsync(input);
      if (requestId === reviewRequest.current) setReview({ input, result });
    } catch (error) {
      toast.push(errorMessage(error), "bad");
    }
  }
  async function generate() {
    if (!review) return;
    try {
      const result = await run.mutateAsync({
        ...review.input,
        fingerprint: review.result.fingerprint,
      });
      downloadCsv(result.fileName, result.csv);
      setReview(null);
      setSelected(new Set());
      toast.push(
        `${result.invoiceCount} merged customer invoice${result.invoiceCount === 1 ? "" : "s"} exported. Re-download from Xero Batches if needed.`,
        "good",
      );
    } catch (error) {
      toast.push(errorMessage(error), "bad");
      setReview(null);
      void options.refetch();
    }
  }
  function sourceTable(rows: Source[], title: string, hint: string) {
    const ready = rows.filter((s) => !s.blocked.length);
    return (
      <Card className="mb-5 overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border p-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-primary">{title}</h2>
            <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
          </div>
          <Chip>
            {rows.filter((s) => selected.has(s.key)).length} / {rows.length} selected
          </Chip>
        </div>
        {rows.length === 0 ? (
          <Empty
            title={`No ${title.toLowerCase()} to invoice`}
            hint={
              title === "Box deliveries"
                ? "Already invoiced, skipped, paused or outside this period."
                : "All website orders have been invoiced or ignored."
            }
          />
        ) : (
          <Table>
            <THead>
              <TH className="w-9">
                <input
                  type="checkbox"
                  aria-label={`Select all ready ${title.toLowerCase()}`}
                  disabled={!ready.length}
                  checked={ready.length > 0 && ready.every((s) => selected.has(s.key))}
                  onChange={() => toggleAll(rows)}
                  className="size-4 accent-accent"
                />
              </TH>
              <TH>Customer / merge match</TH>
              <TH>Source</TH>
              <TH align="right">Value</TH>
              <TH>Status</TH>
            </THead>
            <tbody>
              {rows.map((source) => (
                <TR key={source.key} className={source.blocked.length ? "bg-warning/6" : undefined}>
                  <TD>
                    <input
                      type="checkbox"
                      aria-label={`Select ${source.label} for ${source.customer?.name || "missing customer"}`}
                      disabled={!!source.blocked.length || run.isPending}
                      checked={selected.has(source.key)}
                      onChange={() => toggle(source.key)}
                      className="size-4 accent-accent"
                    />
                  </TD>
                  <TD>
                    <div className="font-medium">
                      {source.customer?.company?.trim() ||
                        source.customer?.name ||
                        "Missing customer"}
                    </div>
                    <div className="mt-0.5 text-[11px] text-muted-foreground">
                      {source.customer?.email?.trim().toLowerCase() ||
                        "No email · match by customer record"}
                    </div>
                  </TD>
                  <TD>
                    <div>{source.label}</div>
                    {source.type === "order" && (
                      <div className="text-[11px] text-muted-foreground">
                        Placed {shortDate(source.date)}
                      </div>
                    )}
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-accent">
                        {source.lines.length} line{source.lines.length === 1 ? "" : "s"}
                      </summary>
                      <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                        {source.lines.map((line, index) => (
                          <li key={index}>
                            {line.quantity} × {line.itemCode || line.description} ·{" "}
                            {money(line.unitAmount)}
                          </li>
                        ))}
                      </ul>
                    </details>
                  </TD>
                  <TD align="right">
                    <Money value={source.total} />
                  </TD>
                  <TD>
                    {source.blocked.length ? (
                      <div className="max-w-xs text-xs text-warning">
                        {source.blocked.join("; ")}
                      </div>
                    ) : (
                      <Chip tone="good">Ready</Chip>
                    )}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    );
  }

  return (
    <div>
      <PageHeader
        title="Billing Run"
        subtitle="Website orders + box subscriptions. Select sources, review one invoice per customer, then export one Xero CSV."
        actions={
          <>
            <Button
              variant="outline"
              onClick={() => void options.refetch()}
              disabled={!validPeriod || options.isFetching}
            >
              <RefreshCw className={options.isFetching ? "animate-spin" : ""} />
              Refresh
            </Button>
            <Button
              onClick={() => void reviewInvoices()}
              disabled={
                !chosen.length ||
                !invoiceDate ||
                !validPeriod ||
                options.isFetching ||
                preview.isPending ||
                run.isPending
              }
            >
              <ArrowRight />
              {preview.isPending
                ? "Preparing review…"
                : `Review ${invoiceCount} invoice${invoiceCount === 1 ? "" : "s"}`}
            </Button>
          </>
        }
      />
      <Card className="mb-5 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Deliveries from" className="w-[155px]">
            <Input
              type="date"
              value={from}
              onChange={(e) => setRange({ from: e.target.value, to })}
            />
          </Field>
          <Field label="Deliveries to" className="w-[155px]">
            <Input
              type="date"
              value={to}
              onChange={(e) => setRange({ from, to: e.target.value })}
            />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!validPeriod}
              onClick={() => range && setRange({ from: addDays(from, -7), to: addDays(to, -7) })}
            >
              Prev week
            </Button>
            <Button variant="outline" size="sm" onClick={() => setRange(weekRange(todayIso()))}>
              This week
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={!validPeriod}
              onClick={() => range && setRange({ from: addDays(from, 7), to: addDays(to, 7) })}
            >
              Next week
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const week = weekRange(todayIso());
                setRange({ from: week.from, to: addDays(week.from, 27) });
              }}
            >
              <CalendarRange />
              Next 4 weeks
            </Button>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-end gap-4 border-t border-border pt-4">
          <Field
            label="Invoice date"
            hint="Defaults to Thursday of the selected week."
            className="w-[230px]"
          >
            <Input
              type="date"
              value={invoiceDate}
              onChange={(e) => setInvoiceDate(e.target.value)}
            />
          </Field>
          <div className="pb-1 text-sm">
            <div className="font-semibold text-primary">Due {shortDate(dueDate)}</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Invoice date + {options.data?.dueDays ?? "…"} days from Settings · INV- numbering
            </p>
          </div>
        </div>
      </Card>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Customer invoices"
          value={invoiceCount}
          hint="One per matching customer / email"
        />
        <Stat
          label="Sources selected"
          value={chosen.length}
          hint={`${chosen.filter((s) => s.type === "delivery").length} deliveries · ${chosen.filter((s) => s.type === "order").length} orders`}
        />
        <Stat label="Selected value" value={money(total)} tone="good" />
        <Stat
          label="Blocked sources"
          value={blocked.length}
          tone={blocked.length ? "warn" : undefined}
        />
      </div>
      <div className="mb-5">
        <Banner>
          Matching emails are merged, ignoring case and surrounding spaces. Blank emails only match
          the same customer record. Subscription contact details take priority; review all merged
          records before export. Each source keeps its own shipping charge.
        </Banner>
      </div>
      {blocked.length > 0 && (
        <div className="mb-4">
          <Banner tone="warn">
            Blocked sources are excluded.{" "}
            <Link to="/orders" className="underline">
              Match website items
            </Link>{" "}
            or{" "}
            <Link to="/products" className="underline">
              fix catalog prices
            </Link>
            , then refresh.
          </Banner>
        </div>
      )}
      {!validPeriod && range ? (
        <Banner tone="bad">Choose a valid delivery period of at most one year.</Banner>
      ) : options.error ? (
        <Banner tone="bad">{errorMessage(options.error)}</Banner>
      ) : options.isLoading || !range ? (
        <Loading label="Finding orders and deliveries" />
      ) : (
        <>
          {sourceTable(
            deliveries,
            "Box deliveries",
            `${shortDate(from)} → ${shortDate(to)} · invoiced, paused and skipped deliveries excluded`,
          )}
          {sourceTable(
            orders,
            "Website orders",
            "All pending website orders, including those outside the delivery period. Choose which to include.",
          )}
        </>
      )}
      <Modal
        open={!!review}
        onClose={() => !run.isPending && setReview(null)}
        title="Review merged Xero invoices"
        wide
        subtitle={
          review
            ? `${review.result.invoiceCount} customer invoices · ${money(review.result.total)} · invoice ${shortDate(review.result.invoiceDate)} · due ${shortDate(review.result.dueDate)}`
            : undefined
        }
        footer={
          <>
            <Button variant="outline" disabled={run.isPending} onClick={() => setReview(null)}>
              Back to selection
            </Button>
            <Button disabled={run.isPending || !review} onClick={() => void generate()}>
              <Download />
              {run.isPending ? "Generating…" : "Generate & download Xero CSV"}
            </Button>
          </>
        }
      >
        <div className="mb-4">
          <Banner>
            Generating marks every selected source invoiced in this app. Import the downloaded CSV
            into Xero yourself. Re-download from Xero Batches; voiding there restores both source
            types.
          </Banner>
        </div>
        <div className="space-y-4">
          {review?.result.invoices.map((invoice) => (
            <Card key={invoice.customerKey} className="overflow-hidden">
              <div className="flex flex-wrap justify-between gap-3 bg-background p-4">
                <div>
                  <h3 className="font-display text-lg font-semibold text-primary">
                    {invoice.contactName}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    {invoice.email || "No email · same customer record only"}
                  </p>
                </div>
                <div className="font-semibold">
                  <Money value={invoice.total} />
                </div>
              </div>
              <div className="border-t border-border px-4 py-3 text-xs">
                <strong>{invoice.sources.length} sources:</strong>{" "}
                {invoice.sources.map((s) => s.label).join("; ")}
                {invoice.matchedCustomers.length > 1 && (
                  <div className="mt-2 text-accent">
                    Matched customer records:{" "}
                    {invoice.matchedCustomers.map((c) => `${c.name} (#${c.id})`).join("; ")}. Using
                    the contact shown above.
                  </div>
                )}
              </div>
              <Table>
                <THead>
                  <TH>Item / source</TH>
                  <TH align="right">Qty</TH>
                  <TH align="right">Unit price</TH>
                  <TH>Account / tax / tracking</TH>
                </THead>
                <tbody>
                  {invoice.lines.map((line, index) => (
                    <TR key={index}>
                      <TD>
                        <div className="font-mono text-xs">{line.itemCode || "—"}</div>
                        <div className="mt-0.5 max-w-sm text-xs">{line.description}</div>
                      </TD>
                      <TD align="right">{line.quantity}</TD>
                      <TD align="right">
                        <Money value={line.unitAmount} />
                      </TD>
                      <TD>
                        <div>{line.accountCode}</div>
                        <div className="text-[11px] text-muted-foreground">{line.taxType}</div>
                        <div className="text-[11px] text-muted-foreground">
                          {line.trackingOption || "No tracking"}
                        </div>
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </Card>
          ))}
        </div>
      </Modal>
    </div>
  );
}
