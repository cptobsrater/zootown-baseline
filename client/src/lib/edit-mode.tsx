/**
 * Editorial mode context. Drives the in-place "edit the live site" experience.
 *
 * Two independent signals combine into the public `isEditing` state:
 *
 *   1. The admin token must be present in memory (subscribed via
 *      subscribeAdminToken). No token => editorial mode is unavailable, full
 *      stop. The floating toggle won't even render.
 *
 *   2. The URL must carry the `?edit=1` flag. The pill toggle flips this flag
 *      on/off so refresh keeps state and admins can paste/share edit links.
 *
 * Why both? Token alone would mean every admin browsing the public site sees
 * edit chrome all the time -- annoying and dangerous. URL alone would let
 * anyone trigger edit mode by typing ?edit=1 (server would still reject the
 * writes, but the chrome would flash on screen). Requiring both keeps the
 * UI calm in normal browsing.
 *
 * Editing dies when:
 *   - The admin closes the tab (in-memory token is cleared on tab close;
 *     see queryClient.ts comments).
 *   - The admin clicks Logout in /admin (setAdminToken(null) fires).
 *   - The admin removes ?edit=1 manually or clicks the pill toggle to "off".
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { getAdminToken, subscribeAdminToken } from "./queryClient";

interface EditModeContextValue {
  /** True iff admin token is present (i.e. someone is logged in this tab). */
  isAdmin: boolean;
  /** True iff isAdmin AND the ?edit=1 URL flag is set. */
  isEditing: boolean;
  /** Toggle edit mode. Flips ?edit=1 on/off in the URL. No-op when !isAdmin. */
  toggleEditing: () => void;
  /** Force edit mode off (e.g. on logout or navigation to admin pages). */
  exitEditing: () => void;
}

const EditModeContext = createContext<EditModeContextValue | undefined>(undefined);

const EDIT_PARAM = "edit";

function readEditFlagFromUrl(): boolean {
  if (typeof window === "undefined") return false;
  return new URLSearchParams(window.location.search).get(EDIT_PARAM) === "1";
}

function writeEditFlagToUrl(on: boolean) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (on) {
    url.searchParams.set(EDIT_PARAM, "1");
  } else {
    url.searchParams.delete(EDIT_PARAM);
  }
  // Use replaceState so toggling doesn't pollute the back-button history.
  window.history.replaceState(window.history.state, "", url.toString());
}

export function EditModeProvider({ children }: { children: ReactNode }) {
  // Track the admin token reactively. The token lives in queryClient's module
  // scope, so we subscribe to changes (login/logout) and re-render.
  const [adminToken, setAdminTokenState] = useState<string | null>(() => getAdminToken());
  useEffect(() => {
    return subscribeAdminToken((t) => setAdminTokenState(t));
  }, []);

  // Track the ?edit=1 flag. Initialized from the URL on mount, then kept in
  // sync via toggleEditing(). We also re-read on browser back/forward so a
  // manual URL change is respected.
  const [editFlag, setEditFlag] = useState<boolean>(() => readEditFlagFromUrl());
  useEffect(() => {
    function onPop() {
      setEditFlag(readEditFlagFromUrl());
    }
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const isAdmin = !!adminToken;
  // Editing is gated on BOTH signals -- see file header for why.
  const isEditing = isAdmin && editFlag;

  const toggleEditing = useCallback(() => {
    if (!isAdmin) return; // refuse to flip the flag if not logged in
    setEditFlag((prev) => {
      const next = !prev;
      writeEditFlagToUrl(next);
      return next;
    });
  }, [isAdmin]);

  const exitEditing = useCallback(() => {
    setEditFlag(false);
    writeEditFlagToUrl(false);
  }, []);

  // If the admin logs out while in edit mode, automatically drop the flag so
  // the chrome disappears immediately.
  useEffect(() => {
    if (!isAdmin && editFlag) {
      setEditFlag(false);
      writeEditFlagToUrl(false);
    }
  }, [isAdmin, editFlag]);

  const value = useMemo<EditModeContextValue>(
    () => ({ isAdmin, isEditing, toggleEditing, exitEditing }),
    [isAdmin, isEditing, toggleEditing, exitEditing],
  );

  return <EditModeContext.Provider value={value}>{children}</EditModeContext.Provider>;
}

export function useEditMode(): EditModeContextValue {
  const ctx = useContext(EditModeContext);
  if (!ctx) throw new Error("useEditMode must be used inside <EditModeProvider>");
  return ctx;
}
