import { useState } from "react";
import { Link } from "wouter";
import { apiRequest, setAdminToken } from "@/lib/queryClient";
import { Wordmark } from "@/components/Logo";
import { Lock, ArrowLeft, Loader2 } from "lucide-react";

export function AdminLogin() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      // Use apiRequest so __PORT_5000__ is rewritten in production.
      // Note: apiRequest throws on non-2xx, so handle 401 inside the catch.
      const res = await apiRequest("POST", "/api/admin/login", { password });
      const data = (await res.json()) as { token: string; expiresAt: number };
      setAdminToken(data.token);
      // No state update needed — token subscriber in admin.tsx handles re-render.
    } catch (err: any) {
      const msg = String(err?.message ?? "");
      if (msg.startsWith("401")) {
        setError("Wrong password.");
        setPassword("");
      } else {
        setError(msg || "Network error");
      }
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-40 border-b border-border bg-background/90 backdrop-blur-md">
        <div className="mx-auto flex w-full max-w-[1200px] items-center justify-between gap-4 px-4 py-3 md:px-6">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-muted-foreground hover-elevate"
              data-testid="link-back"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              Back
            </Link>
            <Wordmark />
          </div>
        </div>
      </header>

      <main className="mx-auto flex min-h-[calc(100vh-65px)] w-full max-w-md items-center justify-center px-4">
        <div className="w-full rounded-lg border border-card-border bg-card p-6 shadow-sm">
          <div className="mb-5 flex items-center gap-2 text-muted-foreground">
            <Lock className="h-4 w-4" />
            <span className="font-mono text-[0.62rem] uppercase tracking-[0.18em]">Admin · Restricted</span>
          </div>
          <h1 className="font-serif text-[1.5rem] font-semibold tracking-tight">Sign in to moderate</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            This area lets you approve, edit, reassign, and delete stories before they go live.
          </p>

          <form onSubmit={submit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="admin-password" className="font-mono text-[0.62rem] uppercase tracking-[0.18em] text-muted-foreground">
                Password
              </label>
              <input
                id="admin-password"
                type="password"
                autoFocus
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                data-testid="input-admin-password"
                className="mt-1.5 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:border-foreground/40 focus:outline-none"
              />
            </div>
            {error && (
              <div
                role="alert"
                data-testid="text-admin-error"
                className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {error}
              </div>
            )}
            <button
              type="submit"
              disabled={busy || password.length === 0}
              data-testid="button-admin-login"
              className="inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover-elevate active-elevate-2 disabled:opacity-60"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Lock className="h-4 w-4" />}
              Unlock admin
            </button>
            <p className="text-[0.7rem] text-muted-foreground">
              Sessions last 30 minutes. Closing this tab signs you out.
            </p>
          </form>
        </div>
      </main>
    </div>
  );
}
