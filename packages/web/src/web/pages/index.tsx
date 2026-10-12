import { Link } from "wouter";
import { ArrowRight, Download, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Banner, Card, Chip, Loading, PageHeader, Stat } from "@/components/ui/misc";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";
import { useDashboard } from "../queries/dashboard";
import { useBatch } from "../queries/billing";
import { downloadCsv, money, shortDate, dayName } from "../lib/format";

export default function Index() {
  const dash = useDashboard();
  const lastBatchId = dash.data?.lastBatch?.id ?? null;
  const lastBatch = useBatch(lastBatchId);

  if (dash.isLoading) return <Loading label="Loading dashboard" />;
  const d = dash.data;
  if (!d) return <Banner tone="bad">Could not load the dashboard.</Banner>;

  const blockers = d.orders.unmatchedLines + d.orders.missingPriceLines;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={`Week of ${shortDate(d.week.from)} – ${shortDate(d.week.to)}. Import orders, bill subscriptions, export a Xero CSV.`}
        actions={
          <>
            <Link to="/orders">
              <Button variant="outline" size="sm">
                Import orders
              </Button>
            </Link>
            <Link to="/billing">
              <Button size="sm" className="bg-accent text-accent-foreground hover:bg-accent/90">
                Run billing <ArrowRight className="size-3.5" />
              </Button>
            </Link>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat
          label="Pending orders"
          value={d.orders.pending}
          hint={`${money(d.orders.pendingValue)} on the website`}
        />
        <Stat
          label="Needs attention"
          value={blockers}
          tone={blockers > 0 ? "warn" : undefined}
          hint={`${d.orders.unmatchedLines} unmatched · ${d.orders.missingPriceLines} without price`}
        />
        <Stat
          label="Active subscriptions"
          value={d.subscriptions.active}
          tone="good"
          hint={`${d.subscriptions.paused} paused · ${money(d.subscriptions.weeklyValue)}/week`}
        />
        <Stat
          label="Deliveries due this week"
          value={d.dueThisWeek.length}
          hint={`${money(d.dueThisWeekValue)} to invoice`}
        />
      </div>

      {blockers > 0 && (
        <div className="mt-4">
          <Banner tone="warn">
            <span className="inline-flex items-center gap-1.5">
              <TriangleAlert className="size-3.5" />
              {d.orders.unmatchedLines > 0 &&
                `${d.orders.unmatchedLines} order line${d.orders.unmatchedLines === 1 ? "" : "s"} could not be matched to a SKU. `}
              {d.orders.missingPriceLines > 0 &&
                `${d.orders.missingPriceLines} line${d.orders.missingPriceLines === 1 ? "" : "s"} have no price yet. `}
              <Link to="/orders" className="underline">
                Fix on Website Orders
              </Link>
            </span>
          </Banner>
        </div>
      )}

      <div className="mt-6 grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="font-display text-base font-semibold text-primary">
              Box deliveries due this week
            </h2>
            <Link to="/billing" className="text-[12px] font-semibold text-accent underline">
              Open billing run
            </Link>
          </div>
          {d.dueThisWeek.length === 0 ? (
            <div className="px-4 py-8 text-center text-[13px] text-muted-foreground">
              Nothing due between {shortDate(d.week.from)} and {shortDate(d.week.to)}.
            </div>
          ) : (
            <Table>
              <THead>
                <TH>Customer</TH>
                <TH>Delivery</TH>
                <TH align="right">Per delivery</TH>
              </THead>
              <tbody>
                {d.dueThisWeek.map((row) => (
                  <TR key={`${row.subscriptionId}-${row.deliveryDate}`}>
                    <TD className="font-medium">{row.customerName}</TD>
                    <TD>
                      {dayName(row.deliveryDate)} {shortDate(row.deliveryDate)}
                    </TD>
                    <TD align="right">{money(row.total)}</TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="p-4">
            <h2 className="font-display text-base font-semibold text-primary">Catalog</h2>
            <div className="mt-3 space-y-2 text-[13px]">
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Products</span>
                <span className="num font-semibold">{d.catalog.total}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Missing a price</span>
                {d.catalog.missingPrice > 0 ? (
                  <Chip tone="warn">{d.catalog.missingPrice}</Chip>
                ) : (
                  <Chip tone="good">all priced</Chip>
                )}
              </div>
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Customers</span>
                <span className="num font-semibold">{d.customerCount}</span>
              </div>
            </div>
            <Link to="/products">
              <Button variant="outline" size="sm" className="mt-3 w-full">
                Manage products
              </Button>
            </Link>
          </Card>

          <Card className="p-4">
            <h2 className="font-display text-base font-semibold text-primary">Last Xero batch</h2>
            {d.lastBatch ? (
              <div className="mt-2 space-y-1.5 text-[13px]">
                <div className="font-medium">{d.lastBatch.label}</div>
                <div className="text-muted-foreground">
                  {d.lastBatch.invoiceCount} invoice{d.lastBatch.invoiceCount === 1 ? "" : "s"} ·{" "}
                  {money(d.lastBatch.total)}
                </div>
                <div className="text-[11px] text-muted-foreground">{d.lastBatch.fileName}</div>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 w-full"
                  disabled={lastBatch.isLoading || !lastBatch.data}
                  onClick={() => {
                    if (lastBatch.data) {
                      downloadCsv(lastBatch.data.fileName, lastBatch.data.csv);
                    }
                  }}
                >
                  <Download className="size-3.5" /> Download again
                </Button>
              </div>
            ) : (
              <p className="mt-2 text-[13px] text-muted-foreground">
                No batches generated yet. Import orders or run subscription billing to create your
                first Xero CSV.
              </p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
