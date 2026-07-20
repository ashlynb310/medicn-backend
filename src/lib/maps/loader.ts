import { getGoogleMapsBrowserKey } from "./config";

// Modern Google Maps JS API loader using the dynamic library import bootstrap.
// After the base script loads, `google.maps.importLibrary(name)` is available
// and callers `await importMapsLibrary("places" | "maps")`. A single shared
// bootstrap avoids injecting the script twice. Callers MUST handle rejection
// (missing key, offline, referrer-restricted key) by falling back — the app
// never blocks on Maps, and the browser never geocodes or authorizes location.

type ImportLibraryFn = (name: string) => Promise<Record<string, unknown>>;

interface GoogleMapsNamespace {
  importLibrary?: ImportLibraryFn;
}

declare global {
  interface Window {
    google?: { maps?: GoogleMapsNamespace };
    __medicnGoogleMapsReady?: () => void;
  }
}

let bootstrapPromise: Promise<void> | null = null;

function ensureBootstrap(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Google Maps can only load in the browser."));
  }
  if (window.google?.maps?.importLibrary) {
    return Promise.resolve();
  }
  if (bootstrapPromise) {
    return bootstrapPromise;
  }

  const key = getGoogleMapsBrowserKey();
  if (!key) {
    return Promise.reject(new Error("Google Maps browser key is not configured."));
  }

  const pending = new Promise<void>((resolve, reject) => {
    let settled = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let injectedScript: HTMLScriptElement | null = null;

    const cleanup = () => {
      if (pollTimer) clearTimeout(pollTimer);
      if (window.__medicnGoogleMapsReady === handleReady) {
        delete window.__medicnGoogleMapsReady;
      }
    };
    const succeed = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    };
    const fail = (error: Error, script?: HTMLElement | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      script?.remove();
      reject(error);
    };
    const handleReady = () => {
      if (window.google?.maps?.importLibrary) {
        succeed();
      } else {
        fail(
          new Error("Google Maps loaded without importLibrary."),
          injectedScript
        );
      }
    };

    const existing = document.getElementById("google-maps-js");
    if (existing) {
      // Another mount already injected the script; wait for readiness.
      const start = Date.now();
      const poll = () => {
        if (window.google?.maps?.importLibrary) {
          succeed();
        } else if (Date.now() - start > 15_000) {
          fail(new Error("Timed out loading Google Maps."), existing);
        } else {
          pollTimer = setTimeout(poll, 50);
        }
      };
      poll();
      return;
    }

    window.__medicnGoogleMapsReady = handleReady;

    const script = document.createElement("script");
    injectedScript = script;
    script.id = "google-maps-js";
    script.async = true;
    script.src =
      "https://maps.googleapis.com/maps/api/js" +
      `?key=${encodeURIComponent(key)}` +
      "&v=weekly&loading=async&callback=__medicnGoogleMapsReady";
    script.addEventListener(
      "error",
      () => {
        fail(new Error("Failed to load Google Maps."), script);
      },
      { once: true }
    );
    document.head.appendChild(script);
    pollTimer = setTimeout(() => {
      fail(new Error("Timed out loading Google Maps."), script);
    }, 15_000);
  });

  bootstrapPromise = pending;
  void pending.catch(() => {
    if (bootstrapPromise === pending) {
      bootstrapPromise = null;
    }
  });

  return bootstrapPromise;
}

/** Loads (once) and returns a Google Maps library, e.g. "places" or "maps". */
export async function importMapsLibrary<T>(name: string): Promise<T> {
  await ensureBootstrap();
  const importLibrary = window.google?.maps?.importLibrary;
  if (!importLibrary) {
    throw new Error("Google Maps importLibrary is unavailable.");
  }
  return importLibrary(name) as Promise<T>;
}
