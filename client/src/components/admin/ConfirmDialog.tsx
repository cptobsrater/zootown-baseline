import { useEffect } from "react";
import { AlertTriangle, X } from "lucide-react";

interface Props {
  title: string;
  body: string;
  confirmLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
  testIdConfirm?: string;
}

export function ConfirmDialog({
  title,
  body,
  confirmLabel = "Confirm",
  destructive = false,
  onConfirm,
  onCancel,
  busy = false,
  testIdConfirm = "button-confirm",
}: Props) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onCancel}
      data-testid="dialog-confirm"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-card-border bg-card shadow-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-border px-5 py-3">
          <div className="flex items-start gap-2">
            {destructive && <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />}
            <h3 className="font-serif text-[1.05rem] font-semibold tracking-tight">{title}</h3>
          </div>
          <button
            onClick={onCancel}
            className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border bg-background hover-elevate"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-muted-foreground">{body}</p>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <button
            onClick={onCancel}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-xs text-muted-foreground hover-elevate"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            data-testid={testIdConfirm}
            className={
              destructive
                ? "inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-xs font-medium text-destructive hover-elevate active-elevate-2 disabled:opacity-60"
                : "inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover-elevate active-elevate-2 disabled:opacity-60"
            }
          >
            {busy ? "Working…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
