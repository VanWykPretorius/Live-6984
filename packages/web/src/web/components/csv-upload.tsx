import * as React from "react";
import { FileUp, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Base64-encode an ArrayBuffer without blowing the call stack on large files. */
function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * Drag-and-drop / click-to-pick file reader. Text files (CSV) are handed to `onFile`
 * as text. When `onBinaryFile` is set, spreadsheet files (.xlsx/.xls) are read as
 * base64 instead so binary workbooks survive the trip to the server.
 */
export function CsvUpload({
  onFile,
  onBinaryFile,
  busy,
  label = "Drop a CSV here",
  hint,
  accept = ".csv,text/csv",
  className,
}: {
  onFile?: (csv: string, fileName: string) => void;
  onBinaryFile?: (base64: string, fileName: string) => void;
  busy?: boolean;
  label?: string;
  hint?: string;
  accept?: string;
  className?: string;
}) {
  const [over, setOver] = React.useState(false);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const read = React.useCallback(
    async (file: File) => {
      const binary = /\.xlsx?$/i.test(file.name) || file.type.includes("spreadsheet");
      if (onBinaryFile && (binary || !onFile)) {
        onBinaryFile(toBase64(await file.arrayBuffer()), file.name);
        return;
      }
      onFile?.(await file.text(), file.name);
    },
    [onFile, onBinaryFile],
  );

  return (
    <button
      type="button"
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        const file = e.dataTransfer.files?.[0];
        if (file) void read(file);
      }}
      onClick={() => inputRef.current?.click()}
      className={cn(
        "flex w-full cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-6 py-8 text-center transition-colors",
        over ? "border-accent bg-accent/8" : "border-border bg-muted/40 hover:border-accent/60",
        busy && "pointer-events-none opacity-60",
        className,
      )}
    >
      {busy ? (
        <Loader2 className="size-5 animate-spin text-accent" />
      ) : (
        <FileUp className="size-5 text-accent" />
      )}
      <div className="text-[13px] font-semibold text-primary">
        {busy ? "Reading file…" : label}
      </div>
      {hint && <div className="max-w-md text-[11px] text-muted-foreground">{hint}</div>}
      <input
        ref={inputRef}
        type="file"
        aria-label="Choose a file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void read(file);
          e.target.value = "";
        }}
      />
    </button>
  );
}
