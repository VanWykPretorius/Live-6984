import * as React from "react";
import { Download, Pencil, Plus, Trash2, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
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
import { TD, TH, THead, TR, Table } from "@/components/ui/table";
import { CsvUpload } from "@/components/csv-upload";
import { useToast } from "@/components/toast";
import {
  useCreateProduct,
  useExportProducts,
  useImportProducts,
  useProducts,
  useRemoveAlias,
  useRemoveProduct,
  useUpdateProduct,
} from "../queries/products";
import { downloadCsv, errorMessage } from "../lib/format";

type Kind = "product" | "box" | "shipping" | "discount";

type Draft = {
  id?: number;
  sku: string;
  description: string;
  unitPrice: string;
  accountCode: string;
  taxType: string;
  trackingOption: string;
  kind: Kind;
  active: boolean;
};

const emptyDraft: Draft = {
  sku: "",
  description: "",
  unitPrice: "",
  accountCode: "",
  taxType: "",
  trackingOption: "",
  kind: "product",
  active: true,
};

export default function Products() {
  const toast = useToast();
  const products = useProducts();
  const create = useCreateProduct();
  const update = useUpdateProduct();
  const remove = useRemoveProduct();
  const removeAlias = useRemoveAlias();
  const importCsv = useImportProducts();
  const exportCsv = useExportProducts();

  const [search, setSearch] = React.useState("");
  const [view, setView] = React.useState<"all" | "needs-price" | "box" | "inactive">("all");
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [uploadOpen, setUploadOpen] = React.useState(false);

  const data = products.data;
  const all = data ?? [];
  const missingPrice = all.filter((p) => p.unitPrice === null || p.unitPrice === 0);

  const rows = React.useMemo(() => {
    const source = data ?? [];
    const q = search.trim().toLowerCase();
    let list = source;
    if (view === "needs-price")
      list = source.filter((p) => p.unitPrice === null || p.unitPrice === 0);
    if (view === "box") list = source.filter((p) => p.kind === "box");
    if (view === "inactive") list = source.filter((p) => !p.active);
    if (!q) return list;
    return list.filter(
      (p) =>
        p.sku.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.aliases.some((a) => a.toLowerCase().includes(q)),
    );
  }, [data, search, view]);

  async function save() {
    if (!draft) return;
    const values = {
      sku: draft.sku.trim(),
      description: draft.description.trim(),
      unitPrice: draft.unitPrice === "" ? null : Number(draft.unitPrice),
      accountCode: draft.accountCode.trim() || null,
      taxType: draft.taxType.trim() || null,
      trackingOption: draft.trackingOption.trim() || null,
      kind: draft.kind,
      active: draft.active,
    };
    try {
      if (draft.id) await update.mutateAsync({ id: draft.id, ...values });
      else await create.mutateAsync(values);
      setDraft(null);
      toast.push(`${values.sku} saved.`, "good");
    } catch (err) {
      toast.push(errorMessage(err), "bad");
    }
  }

  return (
    <div>
      <PageHeader
        title="Products"
        subtitle="The shared SKU catalog. These codes go straight into the Xero CSV, so they must match your Xero items."
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const res = await exportCsv.mutateAsync({});
                downloadCsv(res.fileName, res.csv);
              }}
            >
              <Download className="size-3.5" /> Export
            </Button>
            <Button variant="outline" size="sm" onClick={() => setUploadOpen(true)}>
              <Upload className="size-3.5" /> Import
            </Button>
            <Button size="sm" onClick={() => setDraft({ ...emptyDraft })}>
              <Plus className="size-3.5" /> New product
            </Button>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="SKUs" value={all.length} />
        <Stat
          label="Missing a price"
          value={missingPrice.length}
          tone={missingPrice.length > 0 ? "warn" : "good"}
          hint="blocks invoicing"
        />
        <Stat label="Box SKUs" value={all.filter((p) => p.kind === "box").length} />
        <Stat label="Learned names" value={all.reduce((n, p) => n + p.aliases.length, 0)} />
      </div>

      {missingPrice.length > 0 && (
        <div className="mt-4">
          <Banner tone="warn">
            {missingPrice.length} SKU{missingPrice.length === 1 ? "" : "s"} have no price — any
            order or box using them cannot be invoiced until you fill the price in.
          </Banner>
        </div>
      )}

      <div className="mt-6 mb-3 flex flex-wrap items-center gap-2">
        <Select
          className="w-44"
          value={view}
          onChange={(e) => setView(e.target.value as typeof view)}
        >
          <option value="all">All products</option>
          <option value="needs-price">Needs a price</option>
          <option value="box">Boxes</option>
          <option value="inactive">Inactive</option>
        </Select>
        <Input
          className="w-72"
          placeholder="Search SKU, description, learned name…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card className="overflow-hidden">
        {products.isLoading ? (
          <Loading label="Loading catalog" />
        ) : rows.length === 0 ? (
          <Empty
            title="Nothing here"
            hint="Import your Xero items & services export, or add a SKU by hand."
          />
        ) : (
          <Table>
            <THead>
              <TH>SKU</TH>
              <TH>Description</TH>
              <TH align="right">Unit price</TH>
              <TH>Kind</TH>
              <TH>Account / Tax</TH>
              <TH>Learned names</TH>
              <TH className="w-16" />
            </THead>
            <tbody>
              {rows.map((p) => (
                <TR key={p.id}>
                  <TD className="num font-semibold text-accent">{p.sku}</TD>
                  <TD>
                    {p.description}
                    {!p.active && <Chip className="ml-2">inactive</Chip>}
                  </TD>
                  <TD align="right">
                    <Input
                      className="h-7 w-28 text-right text-[12px]"
                      type="number"
                      step="0.01"
                      placeholder="—"
                      defaultValue={p.unitPrice ?? ""}
                      onBlur={async (e) => {
                        const v = e.target.value;
                        const next = v === "" ? null : Number(v);
                        if (next === p.unitPrice) return;
                        await update.mutateAsync({ id: p.id, unitPrice: next });
                        toast.push(`${p.sku} price updated.`, "good");
                      }}
                    />
                  </TD>
                  <TD>
                    <Chip tone={p.kind === "box" ? "info" : "neutral"}>{p.kind}</Chip>
                  </TD>
                  <TD className="text-[11px] text-muted-foreground">
                    {p.accountCode || "—"} · {p.taxType || "—"}
                    {p.trackingOption ? ` · ${p.trackingOption}` : ""}
                  </TD>
                  <TD>
                    <div className="flex flex-wrap gap-1">
                      {p.aliases.length === 0 ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        p.aliases.map((a) => (
                          <span
                            key={a}
                            className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px]"
                          >
                            {a}
                            <button
                              type="button"
                              onClick={() => removeAlias.mutate({ aliasText: a })}
                              className="text-muted-foreground hover:text-destructive"
                            >
                              <X className="size-3" />
                            </button>
                          </span>
                        ))
                      )}
                    </div>
                  </TD>
                  <TD>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        title="Edit"
                        onClick={() =>
                          setDraft({
                            id: p.id,
                            sku: p.sku,
                            description: p.description,
                            unitPrice: p.unitPrice === null ? "" : String(p.unitPrice),
                            accountCode: p.accountCode ?? "",
                            taxType: p.taxType ?? "",
                            trackingOption: p.trackingOption ?? "",
                            kind: p.kind as Kind,
                            active: p.active,
                          })
                        }
                        className="text-muted-foreground hover:text-primary"
                      >
                        <Pencil className="size-3.5" />
                      </button>
                      <ConfirmButton
                        title="Delete"
                        onConfirm={async () => {
                          try {
                            await remove.mutateAsync({ id: p.id });
                            toast.push(`${p.sku} deleted.`, "info");
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
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal
        open={draft !== null}
        onClose={() => setDraft(null)}
        title={draft?.id ? `Edit ${draft.sku}` : "New product"}
        subtitle="SKU must match the item code in Xero exactly."
        footer={
          <>
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
          <div className="grid grid-cols-2 gap-3">
            <Field label="SKU">
              <Input
                value={draft.sku}
                onChange={(e) => setDraft({ ...draft, sku: e.target.value })}
                placeholder="VEG046"
              />
            </Field>
            <Field label="Unit price (excl. shipping)">
              <Input
                type="number"
                step="0.01"
                value={draft.unitPrice}
                onChange={(e) => setDraft({ ...draft, unitPrice: e.target.value })}
                placeholder="200.00"
              />
            </Field>
            <Field label="Description" className="col-span-2">
              <Input
                value={draft.description}
                onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                placeholder="Weekly Vegetable Box"
              />
            </Field>
            <Field label="Kind" hint="Box SKUs can be selected on a subscription.">
              <Select
                value={draft.kind}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value as Kind })}
              >
                <option value="product">Product / add-on</option>
                <option value="box">Vegetable box</option>
                <option value="shipping">Shipping</option>
                <option value="discount">Discount</option>
              </Select>
            </Field>
            <Field label="Active">
              <Select
                value={draft.active ? "yes" : "no"}
                onChange={(e) => setDraft({ ...draft, active: e.target.value === "yes" })}
              >
                <option value="yes">Active</option>
                <option value="no">Inactive</option>
              </Select>
            </Field>
            <Field label="Account code" hint="Blank uses the default from Settings.">
              <Input
                value={draft.accountCode}
                onChange={(e) => setDraft({ ...draft, accountCode: e.target.value })}
              />
            </Field>
            <Field label="Tax type">
              <Input
                value={draft.taxType}
                onChange={(e) => setDraft({ ...draft, taxType: e.target.value })}
              />
            </Field>
            <Field label="Tracking option" hint="Option in the tracking category set in Settings.">
              <Input
                value={draft.trackingOption}
                onChange={(e) => setDraft({ ...draft, trackingOption: e.target.value })}
              />
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title="Import catalog"
        subtitle="A Xero items export, or any CSV with SKU, description and price columns."
      >
        <CsvUpload
          busy={importCsv.isPending}
          onFile={async (csv, fileName) => {
            try {
              const res = await importCsv.mutateAsync({ csv, updateExisting: true });
              setUploadOpen(false);
              toast.push(
                `${fileName}: ${res.created} created, ${res.updated} updated, ${res.skipped} skipped.`,
                "good",
              );
            } catch (err) {
              toast.push(errorMessage(err), "bad");
            }
          }}
          label="Drop the catalog CSV here, or click to pick a file"
          hint="Recognised headers: ItemCode / SKU / Code, Description / SalesDescription, SalesUnitPrice / Price, SalesAccount, SalesTaxRate."
        />
      </Modal>
    </div>
  );
}
