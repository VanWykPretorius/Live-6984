import * as React from "react";
import { Copy, Eye, EyeOff, RefreshCw, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/input";
import { Banner, Card, Loading, PageHeader } from "@/components/ui/misc";
import { useToast } from "@/components/toast";
import { useRotateApiKey, useSettings, useUpdateSettings } from "@/queries/settings";
import { errorMessage } from "@/lib/format";

type Form = {
  dueDays: number;
  dateFormat: "dd/MM/yyyy" | "yyyy-MM-dd" | "MM/dd/yyyy";
  defaultAccountCode: string;
  defaultTaxType: string;
  trackingCategoryName: string;
  defaultTrackingOption: string;
  currency: string;
  brandingTheme: string;
  orderInvoicePrefix: string;
  subscriptionInvoicePrefix: string;
  shippingSku: string;
  shippingDescription: string;
  shippingAccountCode: string;
  shippingTaxType: string;
  shippingTrackingOption: string;
  discountSku: string;
  discountDescription: string;
  discountTrackingOption: string;
  defaultBoxSku: string;
  defaultBoxPrice: number;
  defaultShippingAmount: number;
};

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="p-5">
      <div className="mb-4">
        <h2 className="font-display text-[15px] font-semibold text-primary">{title}</h2>
        {hint && <p className="mt-0.5 text-[12px] text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </Card>
  );
}

export default function SettingsPage() {
  const toast = useToast();
  const settings = useSettings();
  const update = useUpdateSettings();
  const rotate = useRotateApiKey();

  const [form, setForm] = React.useState<Form | null>(null);
  const [showKey, setShowKey] = React.useState(false);

  React.useEffect(() => {
    const s = settings.data;
    if (!s || form) return;
    setForm({
      dueDays: s.dueDays,
      dateFormat: s.dateFormat as Form["dateFormat"],
      defaultAccountCode: s.defaultAccountCode,
      defaultTaxType: s.defaultTaxType,
      trackingCategoryName: s.trackingCategoryName,
      defaultTrackingOption: s.defaultTrackingOption,
      currency: s.currency,
      brandingTheme: s.brandingTheme ?? "",
      orderInvoicePrefix: s.orderInvoicePrefix,
      subscriptionInvoicePrefix: s.subscriptionInvoicePrefix,
      shippingSku: s.shippingSku,
      shippingDescription: s.shippingDescription,
      shippingAccountCode: s.shippingAccountCode,
      shippingTaxType: s.shippingTaxType,
      shippingTrackingOption: s.shippingTrackingOption,
      discountSku: s.discountSku,
      discountDescription: s.discountDescription,
      discountTrackingOption: s.discountTrackingOption,
      defaultBoxSku: s.defaultBoxSku,
      defaultBoxPrice: s.defaultBoxPrice,
      defaultShippingAmount: s.defaultShippingAmount,
    });
  }, [settings.data, form]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => (f ? { ...f, [key]: value } : f));

  const save = async () => {
    if (!form) return;
    try {
      await update.mutateAsync({
        ...form,
        brandingTheme: form.brandingTheme.trim() || null,
      });
      toast.push("Settings saved.", "good");
    } catch (err) {
      toast.push(errorMessage(err), "bad");
    }
  };

  const ingestUrl = `${typeof window === "undefined" ? "" : window.location.origin}/api/ingest/orders`;

  if (settings.isLoading || !form) {
    return (
      <div>
        <PageHeader title="Settings" />
        <Card>
          <Loading label="Loading settings" />
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Settings"
        subtitle="Defaults every generated Xero invoice inherits. Account codes and tax types must match the ones in your Xero chart of accounts exactly."
        actions={
          <Button onClick={save} disabled={update.isPending}>
            <Save />
            {update.isPending ? "Saving…" : "Save changes"}
          </Button>
        }
      />

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Invoice defaults" hint="Applied to every invoice in a generated CSV.">
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Payment terms (days)"
              hint="Combined invoices: due date = selected invoice date + this. Legacy subscription-only exports use delivery date + this; legacy website-only exports remain due on issue."
            >
              <Input
                type="number"
                min={0}
                value={form.dueDays}
                onChange={(e) => set("dueDays", Number(e.target.value) || 0)}
              />
            </Field>
            <Field label="Date format" hint="Must match your Xero import locale">
              <Select
                value={form.dateFormat}
                onChange={(e) => set("dateFormat", e.target.value as Form["dateFormat"])}
              >
                <option value="dd/MM/yyyy">dd/MM/yyyy</option>
                <option value="yyyy-MM-dd">yyyy-MM-dd</option>
                <option value="MM/dd/yyyy">MM/dd/yyyy</option>
              </Select>
            </Field>
            <Field label="Currency">
              <Input value={form.currency} onChange={(e) => set("currency", e.target.value)} />
            </Field>
            <Field label="Branding theme" hint="Blank uses the Xero default">
              <Input
                value={form.brandingTheme}
                placeholder="Standard"
                onChange={(e) => set("brandingTheme", e.target.value)}
              />
            </Field>
            <Field label="Default account code">
              <Input
                value={form.defaultAccountCode}
                onChange={(e) => set("defaultAccountCode", e.target.value)}
              />
            </Field>
            <Field label="Default tax type">
              <Input
                value={form.defaultTaxType}
                onChange={(e) => set("defaultTaxType", e.target.value)}
              />
            </Field>
            <Field
              label="Tracking category"
              hint="Xero tracking category name. Blank leaves the tracking columns out."
            >
              <Input
                value={form.trackingCategoryName}
                onChange={(e) => set("trackingCategoryName", e.target.value)}
              />
            </Field>
            <Field label="Default tracking option" hint="Used when a product has none of its own.">
              <Input
                value={form.defaultTrackingOption}
                onChange={(e) => set("defaultTrackingOption", e.target.value)}
              />
            </Field>
          </div>
        </Section>

        <Section
          title="Invoice numbering"
          hint="Each run continues from the highest number already used with that prefix."
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Website order prefix" hint="e.g. WEB-0042">
              <Input
                value={form.orderInvoicePrefix}
                onChange={(e) => set("orderInvoicePrefix", e.target.value)}
              />
            </Field>
            <Field label="Subscription prefix" hint="e.g. BOX-0042">
              <Input
                value={form.subscriptionInvoicePrefix}
                onChange={(e) => set("subscriptionInvoicePrefix", e.target.value)}
              />
            </Field>
          </div>
          <div className="mt-3">
            <Banner tone="info">
              Combined Billing Run invoices use their own reserved INV- sequence. Keep the legacy
              website and subscription prefixes different, and do not use INV- for either.
            </Banner>
          </div>
        </Section>

        <Section
          title="Delivery line"
          hint="Added as its own line when an invoice includes shipping. Account code, tax type and tracking are read from the catalog product matching the shipping SKU — the fields below are only used if that SKU is missing from the catalog."
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Shipping SKU" hint="Must match a product in the catalog, e.g. SHIP001">
              <Input
                value={form.shippingSku}
                onChange={(e) => set("shippingSku", e.target.value)}
              />
            </Field>
            <Field label="Shipping description">
              <Input
                value={form.shippingDescription}
                onChange={(e) => set("shippingDescription", e.target.value)}
              />
            </Field>
            <Field label="Shipping account code">
              <Input
                value={form.shippingAccountCode}
                onChange={(e) => set("shippingAccountCode", e.target.value)}
              />
            </Field>
            <Field label="Shipping tax type">
              <Input
                value={form.shippingTaxType}
                onChange={(e) => set("shippingTaxType", e.target.value)}
              />
            </Field>
            <Field label="Shipping tracking option">
              <Input
                value={form.shippingTrackingOption}
                onChange={(e) => set("shippingTrackingOption", e.target.value)}
              />
            </Field>
          </div>
        </Section>

        <Section
          title="Discount line"
          hint="Used for WooCommerce coupon totals, entered as a negative line."
        >
          <div className="grid grid-cols-2 gap-3">
            <Field label="Discount SKU">
              <Input
                value={form.discountSku}
                onChange={(e) => set("discountSku", e.target.value)}
              />
            </Field>
            <Field label="Discount description">
              <Input
                value={form.discountDescription}
                onChange={(e) => set("discountDescription", e.target.value)}
              />
            </Field>
            <Field label="Discount tracking option">
              <Input
                value={form.discountTrackingOption}
                onChange={(e) => set("discountTrackingOption", e.target.value)}
              />
            </Field>
          </div>
        </Section>

        <Section
          title="New subscription defaults"
          hint="Pre-filled when you create a subscription — each one can still be edited."
        >
          <div className="grid grid-cols-3 gap-3">
            <Field label="Default box SKU">
              <Input
                value={form.defaultBoxSku}
                placeholder="VEGBOX"
                onChange={(e) => set("defaultBoxSku", e.target.value)}
              />
            </Field>
            <Field label="Box price">
              <Input
                type="number"
                step="0.01"
                value={form.defaultBoxPrice}
                onChange={(e) => set("defaultBoxPrice", Number(e.target.value) || 0)}
              />
            </Field>
            <Field label="Delivery fee">
              <Input
                type="number"
                step="0.01"
                value={form.defaultShippingAmount}
                onChange={(e) => set("defaultShippingAmount", Number(e.target.value) || 0)}
              />
            </Field>
          </div>
        </Section>

        <Section
          title="Website sync endpoint"
          hint="For later: point a WooCommerce webhook here to drop orders in automatically instead of uploading a CSV."
        >
          <Field label="Endpoint">
            <Input readOnly value={ingestUrl} className="font-mono text-[12px]" />
          </Field>
          <div className="mt-3">
            <Field label="API key" hint="Send as an x-api-key header, or ?key= in the URL.">
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  type={showKey ? "text" : "password"}
                  value={settings.data?.apiKey ?? ""}
                  className="font-mono text-[12px]"
                />
                <Button
                  variant="outline"
                  size="icon"
                  title={showKey ? "Hide" : "Reveal"}
                  onClick={() => setShowKey((v) => !v)}
                >
                  {showKey ? <EyeOff /> : <Eye />}
                </Button>
                <Button
                  variant="outline"
                  size="icon"
                  title="Copy"
                  onClick={() => {
                    navigator.clipboard?.writeText(settings.data?.apiKey ?? "");
                    toast.push("API key copied.", "info");
                  }}
                >
                  <Copy />
                </Button>
                <Button
                  variant="outline"
                  disabled={rotate.isPending}
                  onClick={async () => {
                    try {
                      await rotate.mutateAsync({});
                      toast.push("New API key generated.", "good");
                    } catch (err) {
                      toast.push(errorMessage(err), "bad");
                    }
                  }}
                >
                  <RefreshCw className={rotate.isPending ? "animate-spin" : ""} />
                  Rotate
                </Button>
              </div>
            </Field>
          </div>
          <div className="mt-3">
            <Banner tone="warn">
              Rotating the key breaks any webhook still using the old one. Update the website after
              you rotate.
            </Banner>
          </div>
        </Section>
      </div>

      <div className="mt-5 flex justify-end">
        <Button onClick={save} disabled={update.isPending}>
          <Save />
          {update.isPending ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </div>
  );
}
