import { useState } from 'react';

const PARAM = '_r';

/**
 * Closest thing to Ctrl/Cmd+Shift+R that a web page can do itself:
 * browsers don't let scripts trigger a true hard reload, so we
 *  1. clear any Cache Storage entries and service workers (none today, future-proof),
 *  2. reload under a unique query string so index.html bypasses the HTTP cache.
 * JS/CSS files have content hashes in their names, so a fresh index.html
 * always pulls the latest build.
 */
export async function hardRefresh() {
  try {
    if ('caches' in window) {
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
    }
    if ('serviceWorker' in navigator) {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
    }
  } catch {
    /* best effort — still reload below */
  }
  const url = new URL(window.location.href);
  url.searchParams.set(PARAM, Date.now().toString(36));
  window.location.replace(url.toString()); // keeps #/admin etc.
}

/** Remove the cache-busting parameter from the address bar after load. */
export function cleanRefreshParam() {
  const url = new URL(window.location.href);
  if (url.searchParams.has(PARAM)) {
    url.searchParams.delete(PARAM);
    window.history.replaceState(null, '', url.toString());
  }
}

export default function RefreshButton({ className = '' }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={`refresh-btn ${className}`}
      title="Force refresh: reload the latest version of the app"
      aria-label="Force refresh"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        hardRefresh();
      }}
    >
      <span aria-hidden="true" className={busy ? 'spin' : ''}>⟳</span> {busy ? 'Refreshing…' : 'Refresh'}
    </button>
  );
}
