import { useEffect, useState } from "react";

export interface Loaded<T> {
  data: T | null;
  /** The fetch failed, or the payload didn't pass `accept`. */
  failed: boolean;
  loadedAt: Date | null;
}

/**
 * Fetches one public JSON file once, client-side, uncached. `accept`
 * validates (and may normalize) the payload — null means malformed — and
 * must be a stable, module-level function, or the effect refetches.
 */
export function useJson<T>(url: string, accept: (value: unknown) => T | null): Loaded<T> {
  const [loaded, setLoaded] = useState<Loaded<T>>({ data: null, failed: false, loadedAt: null });
  useEffect(() => {
    let cancelled = false;
    fetch(url, { cache: "no-store" })
      .then((res) => {
        if (!res.ok) throw new Error(`${url}: ${res.status}`);
        return res.json();
      })
      .then((value: unknown) => {
        if (cancelled) return;
        const data = accept(value);
        setLoaded({ data, failed: data === null, loadedAt: data === null ? null : new Date() });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ data: null, failed: true, loadedAt: null });
      });
    return () => {
      cancelled = true;
    };
  }, [url, accept]);
  return loaded;
}
