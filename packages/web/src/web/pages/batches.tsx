import * as React from "react";
import { Download, Eye, Trash2, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { useToast } from "@/components/toast";
import {
  useBatch,
  useBatches,
  useDownloadBatch,
  useRemoveBatch,
  useVoidBatch,
} from "@/queries/billing";
import { errorMessage, money, shortDate } from "@/lib/format";

export default function Batches() {
  const toast = useToast();
  const batches = useBatches();
  const download = useDownloadBatch();
  const voidBatch = useVoidBatch();
  const remove = useRemoveBatch();

  const [previewId, setPreviewId] = React.useState<number | null>(null);
  const [confirmVoid, setConfirmVoid] = React.useState<number | null>(null);
  const preview = useBatch(previewId);

  const rows = batches.data ?? [];
  const live = rows.filter((b) => b.status !== "voided");
  const invoiced = live.reduce((n, b) => n + b.invoiceCount, 0);
  const value = live.reduce((n, b) => n + b.total, 0);

  const doDownload = async (id: number, fileName: string) => {
    try {
      await download.mutateAsync(id);
      toast.push(`${fileName} downloaded.`, "good");
    } catch (err) {
      toast.push(errorMessage(err), "bad");
    }
  };

  const doVoid = async (id: number) => {
    try {
      await voidBatch.mutateAsync({ id });
      setConfirmVoid(null);
      toast.push("Batch voided — those invoices are billable again.", "good");
    } catch (err) {
      toast.push(errorMessage(err), "bad");
    }
  };

  return (
    <div>
      <PageHeader
        title="Xero Batches"
        subtitle="Every CSV this app has produced. Re-download a file any time, or void a batch to make its invoices billable again."
      />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Batches" value={rows.length} hint={`${rows.length - live.length} voided`} />
        <Stat label="Invoices generated" value={invoiced} tone="good" />
        <Stat label="Invoiced value" value={money(value)} />
        <Stat
          label="Lines"
          value={live.reduce((n, b) => n + b.lineCount, 0)}
          hint="CSV rows across live batches"
        />
      </div>

      <div className="mb-4">
        <Banner tone="info">
          Voiding only changes this app: if you already imported the CSV into Xero, delete those
          invoices in Xero too.
        </Banner>
      </div>

      <Card className="overflow-hidden">
        {batches.isLoading ? (
          <Loading label="Loading batches" />
        ) : rows.length === 0 ? (
          <Empty
            title="No batches yet"
            hint="Generate a Xero CSV from the Billing Run or Website Orders page and it will appear here."
          />
        ) : (
          <Table>
            <THead>
              <TH>Batch</TH>
              <TH>Type</TH>
              <TH>Period</TH>
              <TH align="right">Invoices</TH>
              <TH align="right">Lines</TH>
              <TH align="right">Total</TH>
              <TH>Created</TH>
              <TH>Status</TH>
              <TH align="right">Actions</TH>
            </THead>
            <tbody>
              {rows.map((b) => (
                <TR key={b.id} className={b.status === "voided" ? "opacity-60" : undefined}>
                  <TD>
                    <div className="font-medium text-foreground">{b.label}</div>
                    <div className="font-mono text-[11px] text-muted-foreground">{b.fileName}</div>
                  </TD>
                  <TD>
                    <Chip tone={b.type === "orders" ? "info" : "neutral"}>
                      {b.type === "combined"
                        ? "Combined"
                        : b.type === "orders"
                          ? "Website"
                          : "Subscriptions"}
                    </Chip>
                  </TD>
                  <TD className="whitespace-nowrap text-muted-foreground">
                    {b.fromDate === b.toDate
                      ? shortDate(b.fromDate)
                      : `${shortDate(b.fromDate)} → ${shortDate(b.toDate)}`}
                  </TD>
                  <TD align="right">{b.invoiceCount}</TD>
                  <TD align="right">{b.lineCount}</TD>
                  <TD align="right" className="font-semibold">
                    <Money value={b.total} />
                  </TD>
                  <TD className="whitespace-nowrap text-muted-foreground">
                    {shortDate(String(b.createdAt).slice(0, 10))}
                  </TD>
                  <TD>
                    {b.status === "voided" ? (
                      <Chip tone="bad">Voided</Chip>
                    ) : (
                      <Chip tone="good">Live</Chip>
                    )}
                  </TD>
                  <TD align="right">
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Preview CSV"
                        onClick={() => setPreviewId(b.id)}
                      >
                        <Eye />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title="Download CSV"
                        disabled={download.isPending}
                        onClick={() => doDownload(b.id, b.fileName)}
                      >
                        <Download />
                      </Button>
                      {b.status !== "voided" && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title="Void batch"
                          onClick={() => setConfirmVoid(b.id)}
                        >
                          <Undo2 />
                        </Button>
                      )}
                      <ConfirmButton
                        title="Delete record"
                        onConfirm={async () => {
                          try {
                            await remove.mutateAsync({ id: b.id });
                            toast.push("Batch record deleted.", "info");
                          } catch (err) {
                            toast.push(errorMessage(err), "bad");
                          }
                        }}
                        className="inline-flex size-7 items-center justify-center rounded-md text-destructive hover:bg-secondary"
                      >
                        <Trash2 className="size-3.5" />
                      </ConfirmButton>
                    </div>
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal
        open={previewId !== null}
        onClose={() => setPreviewId(null)}
        title="CSV preview"
        subtitle={preview.data?.fileName}
        wide
        footer={
          <>
            <Button variant="outline" onClick={() => setPreviewId(null)}>
              Close
            </Button>
            {preview.data && (
              <Button onClick={() => doDownload(preview.data.id, preview.data.fileName)}>
                <Download />
                Download
              </Button>
            )}
          </>
        }
      >
        {preview.isLoading ? (
          <Loading label="Loading CSV" />
        ) : (
          <pre className="max-h-[52vh] overflow-auto rounded-md bg-muted p-3 font-mono text-[11px] leading-relaxed whitespace-pre">
            {preview.data?.csv ?? ""}
          </pre>
        )}
      </Modal>

      <Modal
        open={confirmVoid !== null}
        onClose={() => setConfirmVoid(null)}
        title="Void this batch?"
        subtitle="The orders and deliveries in it become billable again, so they can appear in a future run."
        footer={
          <>
            <Button variant="outline" onClick={() => setConfirmVoid(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={voidBatch.isPending}
              onClick={() => confirmVoid !== null && doVoid(confirmVoid)}
            >
              Void batch
            </Button>
          </>
        }
      >
        <p className="text-[13px] text-muted-foreground">
          The CSV file record stays here for reference. If this batch was already imported into
          Xero, remove those invoices in Xero as well — otherwise you will end up invoicing the same
          delivery twice.
        </p>
      </Modal>
    </div>
  );
}
