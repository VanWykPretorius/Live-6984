import * as React from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/input";
import { Card, Chip, ConfirmButton, Empty, Loading, Modal, PageHeader, Stat } from "@/components/ui/misc";
import { TD, TH, THead, TR, Table } from "@/components/ui/table";
import { useToast } from "@/components/toast";
import {
  useCreateCustomer,
  useCustomers,
  useRemoveCustomer,
  useUpdateCustomer,
} from "../queries/customers";
import { useSubscriptions } from "../queries/subscriptions";
import { errorMessage } from "../lib/format";

type Draft = {
  id?: number;
  name: string;
  company: string;
  email: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
};

const empty: Draft = {
  name: "",
  company: "",
  email: "",
  phone: "",
  addressLine1: "",
  addressLine2: "",
  city: "",
  region: "",
  postalCode: "",
  country: "South Africa",
};

export default function Customers() {
  const toast = useToast();
  const customers = useCustomers();
  const subs = useSubscriptions();
  const create = useCreateCustomer();
  const update = useUpdateCustomer();
  const remove = useRemoveCustomer();

  const [search, setSearch] = React.useState("");
  const [draft, setDraft] = React.useState<Draft | null>(null);

  const rows = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = customers.data ?? [];
    if (!q) return list;
    return list.filter((c) =>
      [c.name, c.company, c.email, c.city].some((v) => (v ?? "").toLowerCase().includes(q)),
    );
  }, [customers.data, search]);

  const subCount = (customerId: number) =>
    (subs.data ?? []).filter((s) => s.customerId === customerId && s.status !== "cancelled").length;

  async function save() {
    if (!draft) return;
    const values = {
      name: draft.name.trim(),
      company: draft.company.trim() || null,
      email: draft.email.trim() || null,
      phone: draft.phone.trim() || null,
      addressLine1: draft.addressLine1.trim() || null,
      addressLine2: draft.addressLine2.trim() || null,
      city: draft.city.trim() || null,
      region: draft.region.trim() || null,
      postalCode: draft.postalCode.trim() || null,
      country: draft.country.trim() || null,
    };
    try {
      if (draft.id) await update.mutateAsync({ id: draft.id, ...values });
      else await create.mutateAsync(values);
      setDraft(null);
      toast.push(`${values.name} saved.`, "good");
    } catch (err) {
      toast.push(errorMessage(err), "bad");
    }
  }

  return (
    <div>
      <PageHeader
        title="Customers"
        subtitle="Created automatically from website orders, and by hand for box subscribers. The company name is what goes to Xero as the contact when it is filled in."
        actions={
          <Button size="sm" onClick={() => setDraft({ ...empty })}>
            <Plus className="size-3.5" /> New customer
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Customers" value={(customers.data ?? []).length} />
        <Stat
          label="With a subscription"
          value={new Set((subs.data ?? []).filter((s) => s.status !== "cancelled").map((s) => s.customerId)).size}
          tone="good"
        />
        <Stat
          label="Missing an email"
          value={(customers.data ?? []).filter((c) => !c.email).length}
        />
        <Stat
          label="Missing an address"
          value={(customers.data ?? []).filter((c) => !c.addressLine1).length}
        />
      </div>

      <div className="mt-6 mb-3">
        <Input
          className="w-72"
          placeholder="Search name, company, email, city…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card className="overflow-hidden">
        {customers.isLoading ? (
          <Loading label="Loading customers" />
        ) : rows.length === 0 ? (
          <Empty title="No customers yet" hint="Import a website order, or add one by hand." />
        ) : (
          <Table>
            <THead>
              <TH>Name</TH>
              <TH>Company</TH>
              <TH>Email</TH>
              <TH>Phone</TH>
              <TH>Address</TH>
              <TH align="center">Boxes</TH>
              <TH className="w-16" />
            </THead>
            <tbody>
              {rows.map((c) => (
                <TR key={c.id}>
                  <TD className="font-medium">{c.name}</TD>
                  <TD className="max-w-[180px] min-w-[110px] truncate text-muted-foreground" title={c.company ?? ""}>
                    {c.company || "—"}
                  </TD>
                  <TD className="text-muted-foreground">{c.email || "—"}</TD>
                  <TD className="num text-muted-foreground">{c.phone || "—"}</TD>
                  <TD
                    className="max-w-[260px] min-w-[180px] truncate text-[12px] text-muted-foreground"
                    title={[c.addressLine1, c.city, c.postalCode].filter(Boolean).join(", ")}
                  >
                    {[c.addressLine1, c.city, c.postalCode].filter(Boolean).join(", ") || "—"}
                  </TD>
                  <TD align="center">
                    {subCount(c.id) > 0 ? <Chip tone="good">{subCount(c.id)}</Chip> : "—"}
                  </TD>
                  <TD>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        title="Edit"
                        onClick={() =>
                          setDraft({
                            id: c.id,
                            name: c.name,
                            company: c.company ?? "",
                            email: c.email ?? "",
                            phone: c.phone ?? "",
                            addressLine1: c.addressLine1 ?? "",
                            addressLine2: c.addressLine2 ?? "",
                            city: c.city ?? "",
                            region: c.region ?? "",
                            postalCode: c.postalCode ?? "",
                            country: c.country ?? "",
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
                            await remove.mutateAsync({ id: c.id });
                            toast.push(`${c.name} deleted.`, "info");
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
        title={draft?.id ? `Edit ${draft.name}` : "New customer"}
        wide
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
            <Field label="Name">
              <Input
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </Field>
            <Field label="Company" hint="Used as the Xero contact name when present.">
              <Input
                value={draft.company}
                onChange={(e) => setDraft({ ...draft, company: e.target.value })}
              />
            </Field>
            <Field label="Email">
              <Input
                value={draft.email}
                onChange={(e) => setDraft({ ...draft, email: e.target.value })}
              />
            </Field>
            <Field label="Phone">
              <Input
                value={draft.phone}
                onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
              />
            </Field>
            <Field label="Address line 1" className="col-span-2">
              <Input
                value={draft.addressLine1}
                onChange={(e) => setDraft({ ...draft, addressLine1: e.target.value })}
              />
            </Field>
            <Field label="Address line 2" className="col-span-2">
              <Input
                value={draft.addressLine2}
                onChange={(e) => setDraft({ ...draft, addressLine2: e.target.value })}
              />
            </Field>
            <Field label="City">
              <Input
                value={draft.city}
                onChange={(e) => setDraft({ ...draft, city: e.target.value })}
              />
            </Field>
            <Field label="Province / region">
              <Input
                value={draft.region}
                onChange={(e) => setDraft({ ...draft, region: e.target.value })}
              />
            </Field>
            <Field label="Postal code">
              <Input
                value={draft.postalCode}
                onChange={(e) => setDraft({ ...draft, postalCode: e.target.value })}
              />
            </Field>
            <Field label="Country">
              <Input
                value={draft.country}
                onChange={(e) => setDraft({ ...draft, country: e.target.value })}
              />
            </Field>
          </div>
        )}
      </Modal>
    </div>
  );
}
