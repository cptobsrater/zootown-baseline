import { useEffect, useState } from "react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useAdminCity } from "@/lib/admin-city-context";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Save, AlertTriangle, Trash2, ExternalLink } from "lucide-react";

interface SponsorWire {
  id: string;
  name: string;
  logoUrl: string;
  logoAlt: string;
  address: string;
  phone: string;
  tagline: string | null;
  href: string;
  instagram: string | null;
  facebook: string | null;
  isActive: boolean;
  cities: { citySlug: string; sortOrder: number }[];
}

interface Props {
  sponsorId: string | null;
  open: boolean;
  onClose: () => void;
  /** Fires after save/delete so the parent can refresh banner caches. */
  onChange: () => void;
}

/**
 * Editor for a single sponsor row. Loads the full record from
 * /api/admin/sponsors on open, then PATCHes only changed fields on save.
 *
 * Fields:
 *   - Display name + logo URL + logo alt
 *   - Address + phone + tagline
 *   - Destination URL (the banner click target)
 *   - Instagram + Facebook (rendered as icons in the banner)
 *   - is_active toggle (soft disable; takes the banner out of rotation)
 *   - City eligibility list: a row per city the sponsor runs in, with the
 *     sortOrder controlling round-robin position within that city
 *
 * Footer:
 *   - Delete (DELETE; cascades to sponsor_cities)
 *   - Save
 */
export function SponsorEditDialog({ sponsorId, open, onClose, onChange }: Props) {
  const { cities } = useAdminCity();
  // The pristine record from the server -- compared against state on save so
  // we only send the diff.
  const [original, setOriginal] = useState<SponsorWire | null>(null);

  const [name, setName] = useState("");
  const [logoUrl, setLogoUrl] = useState("");
  const [logoAlt, setLogoAlt] = useState("");
  const [address, setAddress] = useState("");
  const [phone, setPhone] = useState("");
  const [tagline, setTagline] = useState("");
  const [href, setHref] = useState("");
  const [instagram, setInstagram] = useState("");
  const [facebook, setFacebook] = useState("");
  const [isActive, setIsActive] = useState(true);
  // Eligibility list as a Map<citySlug, sortOrder> for easy add/remove.
  const [cityRows, setCityRows] = useState<Map<string, number>>(new Map());

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load the sponsor when the dialog opens.
  useEffect(() => {
    if (!sponsorId || !open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await apiRequest("GET", `/api/admin/sponsors`);
        const data = (await res.json()) as { items: SponsorWire[] };
        const found = data.items.find((s) => s.id === sponsorId);
        if (!found) throw new Error(`Sponsor ${sponsorId} not found`);
        if (cancelled) return;
        setOriginal(found);
        setName(found.name);
        setLogoUrl(found.logoUrl);
        setLogoAlt(found.logoAlt);
        setAddress(found.address);
        setPhone(found.phone);
        setTagline(found.tagline ?? "");
        setHref(found.href);
        setInstagram(found.instagram ?? "");
        setFacebook(found.facebook ?? "");
        setIsActive(found.isActive);
        const m = new Map<string, number>();
        for (const c of found.cities) m.set(c.citySlug, c.sortOrder);
        setCityRows(m);
      } catch (e: any) {
        if (!cancelled) setError(typeof e?.message === "string" ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sponsorId, open]);

  if (!open || !sponsorId) return null;

  function toggleCity(slug: string) {
    setCityRows((prev) => {
      const next = new Map(prev);
      if (next.has(slug)) {
        next.delete(slug);
      } else {
        // Default sortOrder = the max + 1 so newly-added cities go to the end.
        const max = next.size === 0 ? -1 : Math.max(...Array.from(next.values()));
        next.set(slug, max + 1);
      }
      return next;
    });
  }

  function setCitySort(slug: string, order: number) {
    setCityRows((prev) => {
      const next = new Map(prev);
      next.set(slug, order);
      return next;
    });
  }

  async function save() {
    if (!original) return;
    setSaving(true);
    setError(null);
    try {
      // Build a sparse PATCH payload -- only changed fields.
      const payload: Record<string, unknown> = {};
      if (name !== original.name) payload.name = name;
      if (logoUrl !== original.logoUrl) payload.logoUrl = logoUrl;
      if (logoAlt !== original.logoAlt) payload.logoAlt = logoAlt;
      if (address !== original.address) payload.address = address;
      if (phone !== original.phone) payload.phone = phone;
      const taglineNorm = tagline.trim() === "" ? null : tagline;
      if (taglineNorm !== original.tagline) payload.tagline = taglineNorm;
      if (href !== original.href) payload.href = href;
      const igNorm = instagram.trim() === "" ? null : instagram;
      if (igNorm !== original.instagram) payload.instagram = igNorm;
      const fbNorm = facebook.trim() === "" ? null : facebook;
      if (fbNorm !== original.facebook) payload.facebook = fbNorm;
      if (isActive !== original.isActive) payload.isActive = isActive;

      // Cities: send the full eligibility set if it differs from the original.
      const desired = Array.from(cityRows.entries())
        .map(([citySlug, sortOrder]) => ({ citySlug, sortOrder }))
        .sort((a, b) => a.sortOrder - b.sortOrder);
      const originalSorted = [...original.cities].sort((a, b) => a.sortOrder - b.sortOrder);
      const citiesChanged =
        desired.length !== originalSorted.length ||
        desired.some(
          (d, i) =>
            d.citySlug !== originalSorted[i].citySlug ||
            d.sortOrder !== originalSorted[i].sortOrder,
        );
      if (citiesChanged) payload.cities = desired;

      if (Object.keys(payload).length === 0) {
        onClose();
        return;
      }
      const res = await apiRequest("PATCH", `/api/admin/sponsors/${sponsorId}`, payload);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      // Bust react-query caches so all open feeds re-fetch banners.
      await queryClient.invalidateQueries({ queryKey: ["/api/sponsors"] });
      onChange();
      onClose();
    } catch (e: any) {
      setError(typeof e?.message === "string" ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function destroy() {
    if (!confirm(`Delete sponsor "${name}" permanently? This removes it from all city rotations.`)) {
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await apiRequest("DELETE", `/api/admin/sponsors/${sponsorId}`);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error ?? `HTTP ${res.status}`);
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/sponsors"] });
      onChange();
      onClose();
    } catch (e: any) {
      setError(typeof e?.message === "string" ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] w-[min(720px,92vw)] max-w-none overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            Edit sponsor {sponsorId}
            {href && (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                title="Open destination URL in a new tab"
              >
                Open destination <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </DialogTitle>
        </DialogHeader>

        {error && (
          <div className="mb-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="py-8 text-center text-sm text-muted-foreground">Loading sponsor…</div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            <div>
              <label className="mb-1 block font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
                Display name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
                  Logo URL (under /sponsors/)
                </label>
                <input
                  type="text"
                  value={logoUrl}
                  onChange={(e) => setLogoUrl(e.target.value)}
                  placeholder="/sponsors/example.png"
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
                  Logo alt text
                </label>
                <input
                  type="text"
                  value={logoAlt}
                  onChange={(e) => setLogoAlt(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
                  Address
                </label>
                <input
                  type="text"
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
                  Phone
                </label>
                <input
                  type="text"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
                Tagline <span className="opacity-60">(optional)</span>
              </label>
              <input
                type="text"
                value={tagline}
                onChange={(e) => setTagline(e.target.value)}
                placeholder="e.g. No Appointment Necessary"
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
              />
            </div>

            <div>
              <label className="mb-1 block font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
                Destination URL (banner click)
              </label>
              <input
                type="url"
                value={href}
                onChange={(e) => setHref(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
                  Instagram URL <span className="opacity-60">(optional)</span>
                </label>
                <input
                  type="url"
                  value={instagram}
                  onChange={(e) => setInstagram(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
                  Facebook URL <span className="opacity-60">(optional)</span>
                </label>
                <input
                  type="url"
                  value={facebook}
                  onChange={(e) => setFacebook(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={isActive}
                onChange={(e) => setIsActive(e.target.checked)}
              />
              <span className="font-medium">Active</span>
              <span className="text-[0.65rem] text-muted-foreground">
                (uncheck to remove from rotation without deleting)
              </span>
            </label>

            {/* City eligibility editor. Toggle a city on/off; tweak sortOrder
                with a small number input. Lower numbers appear first in the
                city's round-robin rotation. */}
            <div className="rounded-md border border-border/60 bg-card/30 p-3">
              <div className="mb-2 font-mono text-[0.62rem] uppercase tracking-[0.16em] text-muted-foreground">
                Runs in cities
              </div>
              <div className="space-y-1.5">
                {cities.map((c) => {
                  const enabled = cityRows.has(c.slug);
                  const order = cityRows.get(c.slug) ?? 100;
                  return (
                    <div key={c.slug} className="flex items-center gap-2 text-sm">
                      <label className="inline-flex flex-1 items-center gap-2">
                        <input
                          type="checkbox"
                          checked={enabled}
                          onChange={() => toggleCity(c.slug)}
                        />
                        <span>{c.displayName}</span>
                      </label>
                      {enabled && (
                        <>
                          <span className="text-[0.65rem] text-muted-foreground">slot</span>
                          <input
                            type="number"
                            value={order}
                            onChange={(e) => setCitySort(c.slug, Number(e.target.value))}
                            min={0}
                            max={9999}
                            className="w-20 rounded-md border border-border bg-background px-2 py-1 text-xs"
                          />
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <div className="mt-5 flex items-center justify-between gap-2 border-t border-border/60 pt-4">
          <button
            type="button"
            onClick={destroy}
            disabled={saving || loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive hover:bg-destructive/15 disabled:opacity-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            Delete sponsor
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="rounded-md border border-border bg-background px-4 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={saving || loading}
              className="inline-flex items-center gap-1.5 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover-elevate disabled:opacity-50"
            >
              <Save className="h-3.5 w-3.5" />
              {saving ? "Saving…" : "Save changes"}
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
