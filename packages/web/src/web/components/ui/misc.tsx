import * as React from "react";
import { Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function Chip({
  tone = "neutral",
  children,
  className,
}: {
  tone?: "neutral" | "good" | "warn" | "bad" | "info";
  children: React.ReactNode;
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: "bg-secondary text-secondary-foreground",
    good: "bg-leaf/12 text-leaf",
    warn: "bg-warning/14 text-warning",
    bad: "bg-destructive/10 text-destructive",
    info: "bg-accent/12 text-accent",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Card({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}) {
  return <div className={cn("card-surface", className)}>{children}</div>;
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-[28px] leading-tight font-semibold text-primary">
          {title}
        </h1>
        {subtitle && <p className="mt-1 max-w-2xl text-[13px] text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string | number;
  hint?: string;
  tone?: "good" | "warn" | "bad";
}) {
  const color =
    tone === "warn"
      ? "text-warning"
      : tone === "bad"
        ? "text-destructive"
        : tone === "good"
          ? "text-leaf"
          : "text-primary";
  return (
    <Card className="p-4">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </div>
      <div className={cn("mt-1.5 font-display text-2xl font-semibold num", color)}>{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-muted-foreground">{hint}</div>}
    </Card>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-4 animate-spin", className)} />;
}

export function Loading({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 p-8 text-sm text-muted-foreground">
      <Spinner /> {label}…
    </div>
  );
}

export function Empty({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="p-10 text-center">
      <div className="font-display text-base font-semibold text-primary">{title}</div>
      {hint && <div className="mx-auto mt-1 max-w-md text-[13px] text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function Money({ value, className }: { value: number | null | undefined; className?: string }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>;
  return (
    <span className={cn("num whitespace-nowrap", className)}>
      R{" "}
      {value.toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </span>
  );
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-primary/25 p-6 backdrop-blur-[2px]">
      <div
        className={cn(
          "my-6 w-full rounded-xl border border-border bg-card shadow-xl",
          wide ? "max-w-4xl" : "max-w-xl",
        )}
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-primary">{title}</h2>
            {subtitle && <p className="mt-0.5 text-[12px] text-muted-foreground">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-secondary"
          >
            <X className="size-4" />
          </button>
        </div>
        <div className="px-5 py-4">{children}</div>
        {footer && (
          <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function Banner({
  tone = "info",
  children,
}: {
  tone?: "info" | "warn" | "bad" | "good";
  children: React.ReactNode;
}) {
  const tones: Record<string, string> = {
    info: "border-accent/30 bg-accent/8 text-accent",
    warn: "border-warning/35 bg-warning/10 text-warning",
    bad: "border-destructive/30 bg-destructive/8 text-destructive",
    good: "border-leaf/30 bg-leaf/8 text-leaf",
  };
  return (
    <div className={cn("rounded-md border px-3 py-2 text-[13px] font-medium", tones[tone])}>
      {children}
    </div>
  );
}

export function ConfirmButton({
  onConfirm,
  title,
  confirmLabel = "Delete",
  className,
  children,
}: {
  onConfirm: () => void | Promise<void>;
  title?: string;
  confirmLabel?: string;
  className?: string;
  children: React.ReactNode;
}) {
  const [armed, setArmed] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const disarm = React.useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setArmed(false);
  }, []);

  React.useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  React.useEffect(() => {
    if (!armed) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") disarm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [armed, disarm]);

  return (
    <span className="relative inline-flex">
      <button
        type="button"
        title={title}
        aria-expanded={armed}
        onClick={() => {
          if (armed) {
            disarm();
            return;
          }
          setArmed(true);
          timer.current = setTimeout(() => setArmed(false), 5000);
        }}
        className={className}
      >
        {children}
      </button>
      {armed && (
        <span className="absolute top-1/2 right-full z-30 mr-1 flex -translate-y-1/2 items-center gap-1 rounded-md border border-border bg-card px-1.5 py-1 shadow-lg">
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm();
                disarm();
              } finally {
                setBusy(false);
              }
            }}
            className="rounded bg-destructive px-1.5 py-0.5 text-[11px] font-semibold whitespace-nowrap text-destructive-foreground disabled:opacity-60"
          >
            {busy ? "…" : confirmLabel}
          </button>
          <button
            type="button"
            onClick={disarm}
            className="px-1 text-[11px] font-medium whitespace-nowrap text-muted-foreground hover:text-foreground"
          >
            No
          </button>
        </span>
      )}
    </span>
  );
}
