import * as React from "react";
import { AlertTriangle, CheckCircle2, Info, X } from "lucide-react";

type Toast = { id: number; message: string; tone: "good" | "bad" | "info" };

const ToastContext = React.createContext<{
  push: (message: string, tone?: Toast["tone"]) => void;
}>({ push: () => {} });

export function useToast() {
  return React.useContext(ToastContext);
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = React.useState<Toast[]>([]);

  const push = React.useCallback((message: string, tone: Toast["tone"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);

  const value = React.useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed right-4 bottom-4 z-[100] flex w-[min(420px,calc(100vw-2rem))] flex-col gap-2">
        {toasts.map((t) => (
          <div
            key={t.id}
            className="pointer-events-auto flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2.5 text-[13px] shadow-lg"
          >
            {t.tone === "good" && <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-leaf" />}
            {t.tone === "bad" && (
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />
            )}
            {t.tone === "info" && <Info className="mt-0.5 size-4 shrink-0 text-accent" />}
            <span className="flex-1 leading-snug">{t.message}</span>
            <button
              type="button"
              onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
