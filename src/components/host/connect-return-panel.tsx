"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Skeleton } from "@/components/ui/skeleton";
import ErrorState from "@/components/ui/error-state";
import { useAuth } from "@/components/auth/auth-provider";
import {
  ConnectAccountFacts,
  ConnectRequirements,
  PayoutStatusHeader,
  connectErrorRecovery,
  toConnectRequestError,
  type ConnectRequestError,
} from "@/components/host/host-payouts-panel";
import { getConnectAccount, type ConnectAccount } from "@/lib/api/connect";
import { ApiError } from "@/lib/api/client";
import {
  connectStateOwnerKey,
  isStaleConnectRequest,
} from "@/lib/connect/payouts";

/**
 * Shown when Stripe redirects back to /host/connect/return or
 * /host/connect/refresh.
 *
 * Arriving here is NOT proof that onboarding succeeded — the only authority is
 * GET /connect/account, which this panel calls on mount. Nothing about the
 * redirect (path, query, referrer) is treated as a result, and no query
 * parameters are read or displayed.
 */
export default function ConnectReturnPanel({
  mode,
}: {
  mode: "return" | "refresh";
}) {
  const {
    status: authStatus,
    profileStatus,
    accessToken,
    sessionUserId,
    user,
  } = useAuth();

  if (authStatus === "loading") {
    return <Skeleton className="h-64 w-full" />;
  }

  if (authStatus !== "authenticated") {
    return (
      <ErrorState
        title="Sign in to see your payout status"
        message="We can only show your authoritative payout status while you're signed in."
        action={<ButtonLink href="/login?returnTo=/host/payouts">Log in</ButtonLink>}
      />
    );
  }

  const ownsCurrentProfile =
    user !== null && user.supabaseUserId === sessionUserId;

  if (!ownsCurrentProfile) {
    if (profileStatus === "loading") {
      return <Skeleton className="h-64 w-full" />;
    }
    return (
      <ErrorState
        title="We couldn't load your MediCN profile"
        message="Your authenticated account must be available before payout status can load."
      />
    );
  }

  return (
    <ConnectReturnState
      key={connectStateOwnerKey(user.id, mode)}
      mode={mode}
      accessToken={accessToken}
    />
  );
}

function ConnectReturnState({
  mode,
  accessToken,
}: {
  mode: "return" | "refresh";
  accessToken: string | null;
}) {
  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [account, setAccount] = useState<ConnectAccount | null>(null);
  const [error, setError] = useState<ConnectRequestError | null>(null);
  const requestRef = useRef<AbortController | null>(null);

  const load = useCallback(() => {
    requestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const isStale = () =>
      isStaleConnectRequest(
        controller.signal.aborted,
        requestRef.current === controller
      );

    getConnectAccount(accessToken ?? undefined, controller.signal)
      .then((data) => {
        if (isStale()) return;
        setAccount(data);
        setPhase("ready");
        setError(null);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === "AbortError") return;
        if (isStale()) return;
        if (err instanceof ApiError) {
          if (err.code === "NOT_FOUND" || err.code === "CONNECT_ONBOARDING_REQUIRED") {
            setAccount(null);
            setPhase("ready");
            setError(null);
            return;
          }
          setError(toConnectRequestError(err));
        } else {
          setError(toConnectRequestError(err));
        }
        setPhase("error");
      });
  }, [accessToken]);

  useEffect(() => {
    load();
    return () => requestRef.current?.abort();
  }, [load]);

  if (phase === "loading") {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-56 w-full" />
      </div>
    );
  }

  if (phase === "error" && error) {
    return (
      <ErrorState
        title="We couldn't confirm your payout status"
        message={[error.message, connectErrorRecovery(error)]
          .filter(Boolean)
          .join(" ")}
        action={
          <Button variant="outline" onClick={load}>
            Try again
          </Button>
        }
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
        {mode === "refresh"
          ? "Your Stripe session needs to be restarted. Here is your current status from MediCN."
          : "Thanks — you've returned from Stripe. Returning doesn't by itself confirm setup, so here is your authoritative status from MediCN."}
      </p>

      <PayoutStatusHeader account={account} />

      {account ? (
        <>
          <ConnectAccountFacts account={account} />
          <ConnectRequirements account={account} />
        </>
      ) : (
        <p className="text-sm text-slate-600">
          No payout account is recorded yet. Start setup from your payout
          settings.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={load}>
          <RefreshCw aria-hidden="true" />
          Refresh status
        </Button>
        <ButtonLink href="/host/payouts">Payout settings</ButtonLink>
        <ButtonLink href="/host" variant="outline">
          Host dashboard
        </ButtonLink>
      </div>
    </div>
  );
}
