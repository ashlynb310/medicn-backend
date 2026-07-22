"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { CircleAlert, Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth/auth-provider";
import { createAdminEvidenceViewUrl } from "@/lib/api/healthcare-admin";
import type { AdminHealthcareEvidenceRef } from "@/lib/api/healthcare-admin";
import { ApiError, toErrorMessage } from "@/lib/api/client";
import {
  allowLoopbackHttpInThisEnvironment,
  createEvidenceViewGeneration,
  evidenceViewRemainingMs,
  isEvidenceViewStale,
  normalizeEvidenceViewUrl,
  resolveEvidenceViewState,
  type EvidenceViewGeneration,
} from "@/lib/healthcare/admin-review";

interface HeldView {
  generation: EvidenceViewGeneration;
  viewUrl: string;
  expiresAt: string;
  receivedAtMs: number;
}

/**
 * One sanitized evidence image, revealed only on an explicit, audited Admin
 * action.
 *
 * The signed URL lives ONLY in ephemeral component state, is normalized and
 * scheme-validated before being held (HTTPS everywhere; HTTP only for loopback
 * outside production), and is visible for at most 60 seconds from receipt
 * regardless of the backend's stated expiry. It is never written to a route,
 * query string, log, storage, cookie, analytics event, error message, or any
 * persisted state, and the queue never preloads it.
 *
 * Context changes (account session, submission, evidence, clear signal) mint a
 * new opaque generation, which makes a previously held URL non-renderable
 * during render — before any effect cleanup runs.
 */
export default function AdminHealthcareEvidenceViewer({
  verificationId,
  evidence,
  index,
  viewable,
  clearToken,
}: {
  verificationId: string;
  evidence: AdminHealthcareEvidenceRef;
  index: number;
  /** Backend only mints URLs for ready evidence on a pending_review submission. */
  viewable: boolean;
  /** Increments to force-clear the held URL (decision, refresh). */
  clearToken: number;
}) {
  const { accessToken } = useAuth();
  const allowLoopbackHttp = allowLoopbackHttpInThisEnvironment();

  // Opaque, zero-data identity. The token is a dependency only — never an
  // argument, and never stored, hashed, serialized, rendered, or logged.
  // The deps are the semantic trigger for minting a NEW identity; the factory
  // takes no arguments, so the access token is never passed into, or captured
  // by, the generation.
  const generation = useMemo(
    () => createEvidenceViewGeneration(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accessToken, verificationId, evidence.id, clearToken]
  );

  const [view, setView] = useState<HeldView | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ code: string; message: string } | null>(
    null
  );
  const [now, setNow] = useState(() => Date.now());
  const requestRef = useRef<AbortController | null>(null);
  // Tracks the CURRENT generation so an async closure can compare its captured
  // generation against the latest one. Holds only the opaque object — never the
  // access token.
  //
  // This MUST run at layout-effect timing: it is committed synchronously as part
  // of the context-changing render, before the browser can run a pending async
  // continuation. With a passive effect there is a window in which a new
  // generation has rendered but the ref still holds the old one, letting a stale
  // response touch view/error/loading state.
  const generationRef = useRef<EvidenceViewGeneration>(generation);
  useLayoutEffect(() => {
    generationRef.current = generation;
  }, [generation]);

  const clear = () => {
    setView(null);
    setNow(Date.now());
  };

  // Abort in-flight work and drop any held URL when the context changes or the
  // component unmounts.
  useEffect(() => {
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
      setView(null);
      setError(null);
      setLoading(false);
    };
  }, [accessToken, verificationId, evidence.id, clearToken]);

  // Expiry ticker: runs only while a URL is held and drops it at the effective
  // (capped) expiry. Rendering is independently gated below, so an already
  // expired URL never shows even before this fires.
  useEffect(() => {
    if (!view) return;
    const remaining = evidenceViewRemainingMs(
      view.expiresAt,
      view.receivedAtMs,
      Date.now()
    );
    const tick = setInterval(() => setNow(Date.now()), 1_000);
    const expiry = setTimeout(() => setView(null), Math.max(0, remaining));
    return () => {
      clearInterval(tick);
      clearTimeout(expiry);
    };
  }, [view]);

  // Synchronous staleness: a URL from a previous generation is dropped during
  // this render, not later in an effect.
  const held = view && !isEvidenceViewStale(generation, view.generation) ? view : null;
  const viewState = resolveEvidenceViewState(held, now, allowLoopbackHttp);
  const remainingSeconds = held
    ? Math.ceil(
        evidenceViewRemainingMs(held.expiresAt, held.receivedAtMs, now) / 1000
      )
    : 0;

  const requestView = async () => {
    if (loading) return;
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const attemptGeneration = generation;
    setError(null);
    setLoading(true);
    try {
      const result = await createAdminEvidenceViewUrl(
        verificationId,
        evidence.id,
        accessToken ?? undefined,
        controller.signal
      );
      // A late response from a replaced generation/attempt must not install a
      // URL or touch visible state.
      if (
        controller.signal.aborted ||
        requestRef.current !== controller ||
        attemptGeneration !== generationRef.current
      ) {
        return;
      }
      const receivedAtMs = Date.now();
      const normalized = normalizeEvidenceViewUrl(
        result.viewUrl,
        allowLoopbackHttp
      );
      if (!normalized) {
        // Never hold or render an unsafe URL, and never echo it.
        setError({
          code: "UNSAFE_EVIDENCE_URL",
          message: "The review image could not be opened safely.",
        });
        return;
      }
      setNow(receivedAtMs);
      setView({
        generation: attemptGeneration,
        viewUrl: normalized,
        expiresAt: result.expiresAt,
        receivedAtMs,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      if (
        controller.signal.aborted ||
        requestRef.current !== controller ||
        attemptGeneration !== generationRef.current
      ) {
        return;
      }
      // The URL is never echoed into error text.
      setError(
        err instanceof ApiError
          ? { code: err.code, message: err.message }
          : { code: "UNKNOWN", message: toErrorMessage(err) }
      );
    } finally {
      if (
        requestRef.current === controller &&
        attemptGeneration === generationRef.current
      ) {
        setLoading(false);
      }
    }
  };

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-slate-200 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-slate-800">
          Image {index + 1}
        </span>
        <span className="flex items-center gap-2">
          <span
            className={`rounded-full px-2 py-0.5 text-xs font-medium ${
              evidence.ready
                ? "bg-green-100 text-green-800"
                : "bg-amber-100 text-amber-900"
            }`}
          >
            {evidence.ready ? "Ready" : "Not ready"}
          </span>
          {viewState.renderable ? (
            <Button variant="outline" size="sm" onClick={clear}>
              <EyeOff aria-hidden="true" />
              Hide
            </Button>
          ) : (
            <Button
              variant="outline"
              size="sm"
              onClick={requestView}
              disabled={!viewable || !evidence.ready || loading}
            >
              {loading ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <Eye aria-hidden="true" />
              )}
              {loading ? "Opening…" : "View"}
            </Button>
          )}
        </span>
      </div>

      {!viewable && evidence.ready && (
        <p className="text-xs text-slate-500">
          Evidence can only be viewed while the submission is pending review.
        </p>
      )}

      {viewState.reason === "expired" && (
        <p className="text-xs text-slate-600">
          That view link expired. Choose View again to open a new one.
        </p>
      )}
      {(viewState.reason === "unsafe_url" ||
        viewState.reason === "invalid_expiry") && (
        <p role="alert" className="text-xs text-red-700">
          The review image could not be opened safely.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="flex items-center gap-2 text-xs font-medium text-red-700"
        >
          <CircleAlert className="size-3.5 shrink-0" aria-hidden="true" />
          {error.message}
        </p>
      )}

      {viewState.renderable && held && (
        <div className="flex flex-col gap-1.5">
          {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed private URL, never a persisted asset */}
          <img
            src={held.viewUrl}
            alt={`Sanitized credential evidence ${index + 1}`}
            referrerPolicy="no-referrer"
            className="max-h-[28rem] w-full rounded-lg border border-slate-200 object-contain"
          />
          <p className="text-xs text-slate-500">
            This link expires in {remainingSeconds}s. Viewing is recorded in the
            MediCN audit log.
          </p>
        </div>
      )}
    </li>
  );
}
