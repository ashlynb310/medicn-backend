"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleAlert, ExternalLink, RefreshCw, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ButtonLink } from "@/components/ui/button-link";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import ErrorState from "@/components/ui/error-state";
import FormField from "@/components/form/form-field";
import { useAuth } from "@/components/auth/auth-provider";
import {
  createConnectManagementLink,
  createConnectOnboardingLink,
  createConnectedAccount,
  getConnectAccount,
  type ConnectAccount,
} from "@/lib/api/connect";
import { ApiError, toErrorMessage } from "@/lib/api/client";
import {
  allowLoopbackHttpInThisEnvironment,
  normalizeConnectAccountLinkUrl,
} from "@/lib/safe-url";
import {
  canViewPayoutSettings,
  connectErrorRecovery as formatConnectErrorRecovery,
  connectStateOwnerKey,
  describePayoutReadiness,
  formatCapability,
  formatCountry,
  formatCurrency,
  formatSynchronizedAt,
  formatTriState,
  hasRequirements,
  isStaleConnectRequest,
  normalizeCountryInput,
  summarizeConnectRequirements,
  type PayoutTone,
} from "@/lib/connect/payouts";

const TONE_CLASS: Record<PayoutTone, string> = {
  neutral: "bg-slate-100 text-slate-700",
  info: "bg-sky-100 text-sky-800",
  warning: "bg-amber-100 text-amber-900",
  success: "bg-green-100 text-green-800",
  danger: "bg-red-100 text-red-800",
};

export function connectErrorHint(code: string): string | null {
  switch (code) {
    case "CONNECT_NOT_CONFIGURED":
      return "Payouts aren't enabled on MediCN yet. You can keep managing listings in the meantime.";
    case "CONNECT_ONBOARDING_REQUIRED":
      return "Set up your payout account first, then continue in Stripe.";
    case "CONNECT_PROVIDER_UNAVAILABLE":
      return "Stripe is temporarily unavailable. Please try again shortly.";
    case "FORBIDDEN":
      return "Payout setup is only available to host accounts.";
    case "NOT_FOUND":
      return "No payout account was found for this host yet.";
    case "ACCOUNT_DISABLED":
      return "This account can't set up payouts.";
    case "VALIDATION_ERROR":
      return "Check the country code and try again.";
    case "UNAUTHORIZED":
    case "INVALID_SUPABASE_TOKEN":
      return "Your session expired. Sign out and back in, then try again.";
    default:
      return null;
  }
}

export interface ConnectRequestError {
  code: string;
  message: string;
  retryAfter: number | null;
  status: number | null;
}

export function toConnectRequestError(error: unknown): ConnectRequestError {
  if (error instanceof ApiError) {
    return {
      code: error.code,
      message: error.message,
      retryAfter: error.retryAfterSeconds,
      status: error.status,
    };
  }
  return {
    code: "UNKNOWN",
    message: toErrorMessage(error),
    retryAfter: null,
    status: null,
  };
}

export function connectErrorRecovery(error: ConnectRequestError) {
  return formatConnectErrorRecovery(error, connectErrorHint(error.code));
}

export function ConnectErrorNotice({ error }: { error: ConnectRequestError }) {
  const hint = connectErrorRecovery(error);
  return (
    <div
      role="alert"
      className="flex flex-col gap-1 rounded-lg border border-red-200 bg-red-50 p-3"
    >
      <p className="flex items-center gap-2 text-sm font-semibold text-red-800">
        <CircleAlert className="size-4" aria-hidden="true" />
        {error.message}
      </p>
      {hint && <p className="text-xs text-red-700">{hint}</p>}
    </div>
  );
}

/** Read-only account facts. Only backend-provided safe fields are shown. */
export function ConnectAccountFacts({ account }: { account: ConnectAccount }) {
  const rows: Array<[string, string]> = [
    ["Country", formatCountry(account.country)],
    ["Currency", formatCurrency(account.currency)],
    ["Details submitted", formatTriState(account.detailsSubmitted)],
    ["Transfers capability", formatCapability(account.transfersCapability)],
    ["Transfers ready", formatTriState(account.transfersReady)],
    ["Payouts enabled", formatTriState(account.payoutsEnabled)],
    ["Last synchronized", formatSynchronizedAt(account.lastSynchronizedAt)],
  ];
  return (
    <dl className="rounded-xl border border-slate-200 p-4">
      {rows.map(([label, value]) => (
        <div
          key={label}
          className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-2.5 last:border-b-0"
        >
          <dt className="text-sm text-slate-600">{label}</dt>
          <dd className="text-sm font-medium text-slate-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Requirement keys reported by Stripe. Counts and keys only — no PII. */
export function ConnectRequirements({ account }: { account: ConnectAccount }) {
  const pastDue = summarizeConnectRequirements(
    account.requirementsPastDue,
    "past_due"
  );
  const currentlyDue = summarizeConnectRequirements(
    account.requirementsCurrentlyDue,
    "currently_due"
  );
  if (!hasRequirements(pastDue) && !hasRequirements(currentlyDue)) return null;
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4">
      <h3 className="text-sm font-semibold text-amber-900">
        Stripe still needs information
      </h3>
      {hasRequirements(pastDue) && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-amber-900">
            Overdue ({pastDue.length})
          </span>
          <ul className="list-inside list-disc text-xs text-amber-900">
            {pastDue.map((item) => (
              <li key={item.key}>{item.text}</li>
            ))}
          </ul>
        </div>
      )}
      {hasRequirements(currentlyDue) && (
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium text-amber-900">
            Currently due ({currentlyDue.length})
          </span>
          <ul className="list-inside list-disc text-xs text-amber-900">
            {currentlyDue.map((item) => (
              <li key={item.key}>{item.text}</li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-xs text-amber-800">
        You provide this information directly to Stripe. MediCN never collects
        or stores it.
      </p>
    </div>
  );
}

export function PayoutStatusHeader({ account }: { account: ConnectAccount | null }) {
  const readiness = describePayoutReadiness(account);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-slate-900">
          <Wallet className="size-5 text-slate-700" aria-hidden="true" />
          Payout status
        </h2>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${TONE_CLASS[readiness.tone]}`}
        >
          {readiness.label}
        </span>
      </div>
      <p className="text-sm text-slate-700">{readiness.description}</p>
    </div>
  );
}

export default function HostPayoutsPanel() {
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
        title="Sign in to set up payouts"
        message="Payout settings are available after you sign in with a host account."
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
        message="Your authenticated account must be available before payout settings can load."
      />
    );
  }

  const isHost = canViewPayoutSettings(user.roles);

  if (!isHost) {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 p-5">
          <h2 className="text-base font-semibold text-slate-900">
            Payout setup is for host accounts
          </h2>
          <p className="text-sm text-slate-600">
            Become a host to list a property and receive payouts.
          </p>
        </div>
        <ButtonLink href="/host" variant="outline" className="w-fit">
          Host dashboard
        </ButtonLink>
      </div>
    );
  }

  return (
    <HostPayoutsState
      key={connectStateOwnerKey(user.id)}
      accessToken={accessToken}
    />
  );
}

function HostPayoutsState({ accessToken }: { accessToken: string | null }) {

  const [phase, setPhase] = useState<"loading" | "ready" | "error">("loading");
  const [account, setAccount] = useState<ConnectAccount | null>(null);
  const [loadError, setLoadError] = useState<ConnectRequestError | null>(null);
  const [actionError, setActionError] = useState<ConnectRequestError | null>(null);
  const [country, setCountry] = useState("");
  const [countryError, setCountryError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "create" | "onboard" | "manage">(null);

  const loadRef = useRef<AbortController | null>(null);
  const actionRef = useRef<AbortController | null>(null);
  const allowLoopbackHttp = allowLoopbackHttpInThisEnvironment();

  const load = useCallback(() => {
    loadRef.current?.abort();
    const controller = new AbortController();
    loadRef.current = controller;
    const isStale = () =>
      isStaleConnectRequest(
        controller.signal.aborted,
        loadRef.current === controller
      );

    getConnectAccount(accessToken ?? undefined, controller.signal)
      .then((data) => {
        if (isStale()) return;
        setAccount(data);
        setPhase("ready");
        setLoadError(null);
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        if (isStale()) return;
        const request = toConnectRequestError(error);
        // No account yet is a normal starting state, not a failure.
        if (request.code === "NOT_FOUND" || request.code === "CONNECT_ONBOARDING_REQUIRED") {
          setAccount(null);
          setPhase("ready");
          setLoadError(null);
          return;
        }
        setLoadError(request);
        setPhase("error");
      });
  }, [accessToken]);

  useEffect(() => {
    load();
    return () => loadRef.current?.abort();
  }, [load]);

  // Cancel any in-flight action on unmount or token change.
  useEffect(
    () => () => {
      actionRef.current?.abort();
    },
    [accessToken]
  );

  const beginAction = () => {
    actionRef.current?.abort();
    const controller = new AbortController();
    actionRef.current = controller;
    return controller;
  };

  const finishAction = (controller: AbortController) => {
    if (actionRef.current === controller) {
      actionRef.current = null;
      setBusy(null);
    }
  };

  const isStaleAction = (controller: AbortController) =>
    isStaleConnectRequest(
      controller.signal.aborted,
      actionRef.current === controller
    );

  const createAccount = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const parsed = normalizeCountryInput(country);
    if (!parsed.valid) {
      setCountryError("Enter a two-letter country code, such as US or GB.");
      return;
    }
    setCountryError(null);
    setActionError(null);
    const controller = beginAction();
    setBusy("create");
    try {
      const created = await createConnectedAccount(
        parsed.normalized,
        accessToken ?? undefined,
        controller.signal
      );
      if (isStaleAction(controller)) return;
      setAccount(created);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (isStaleAction(controller)) return;
      setActionError(toConnectRequestError(error));
    } finally {
      finishAction(controller);
    }
  };

  const openHostedFlow = async (kind: "onboard" | "manage") => {
    if (busy) return;
    setActionError(null);
    const controller = beginAction();
    setBusy(kind);
    try {
      const link =
        kind === "onboard"
          ? await createConnectOnboardingLink(
              accessToken ?? undefined,
              controller.signal
            )
          : await createConnectManagementLink(
              accessToken ?? undefined,
              controller.signal
            );
      if (isStaleAction(controller)) return;
      // Validate the entire response only after ownership is confirmed. The
      // normalized URL remains a transient local and is never stored/rendered.
      const safeUrl = normalizeConnectAccountLinkUrl(
        link,
        kind === "onboard" ? "account_onboarding" : "account_update",
        allowLoopbackHttp
      );
      if (!safeUrl) {
        setActionError({
          code: "INVALID_CONNECT_LINK",
          message: "Stripe returned a link that couldn't be opened safely.",
          retryAfter: null,
          status: null,
        });
        return;
      }
      window.location.assign(safeUrl);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      if (isStaleAction(controller)) return;
      setActionError(toConnectRequestError(error));
    } finally {
      finishAction(controller);
    }
  };

  if (phase === "loading") {
    return (
      <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (phase === "error" && loadError) {
    // CONNECT_NOT_CONFIGURED is an honest "not available yet", not a crash.
    if (loadError.code === "CONNECT_NOT_CONFIGURED") {
      return (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2 rounded-xl border border-slate-200 bg-slate-50 p-5">
            <h2 className="text-base font-semibold text-slate-900">
              Payouts aren&apos;t available yet
            </h2>
            <p className="text-sm text-slate-600">
              MediCN hasn&apos;t enabled payout accounts yet. You can keep
              creating and managing listings in the meantime.
            </p>
          </div>
          <ButtonLink href="/host/listings" variant="outline" className="w-fit">
            My listings
          </ButtonLink>
        </div>
      );
    }
    return (
      <ErrorState
        title={
          loadError.code === "FORBIDDEN"
            ? "Payout setup isn't available for this account"
            : "We couldn't load your payout status"
        }
        message={[loadError.message, connectErrorRecovery(loadError)]
          .filter(Boolean)
          .join(" ")}
        action={
          loadError.code === "FORBIDDEN" ? undefined : (
            <Button variant="outline" onClick={load}>
              Try again
            </Button>
          )
        }
      />
    );
  }

  const readiness = describePayoutReadiness(account);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <PayoutStatusHeader account={account} />
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw aria-hidden="true" />
          Refresh status
        </Button>
      </div>

      <p className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
        Stripe collects and verifies your identity and bank details directly.
        MediCN never asks for, receives, or stores bank accounts, card numbers,
        government IDs, or tax identifiers.
      </p>

      {actionError && <ConnectErrorNotice error={actionError} />}

      {!account ? (
        <form
          onSubmit={createAccount}
          className="flex flex-col gap-3 rounded-xl border border-slate-200 p-5"
          aria-label="Set up payouts"
        >
          <h3 className="text-sm font-semibold text-slate-900">
            Set up payouts
          </h3>
          <FormField
            label="Country"
            required
            hint="Two-letter country code for your payout account, such as US or GB."
            error={countryError ?? undefined}
          >
            {({ id }) => (
              <Input
                id={id}
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                maxLength={2}
                autoCapitalize="characters"
                placeholder="US"
                className="sm:max-w-24"
              />
            )}
          </FormField>
          <Button type="submit" disabled={busy !== null} className="w-fit">
            {busy === "create" ? "Creating…" : "Create payout account"}
          </Button>
        </form>
      ) : (
        <>
          <ConnectAccountFacts account={account} />
          <ConnectRequirements account={account} />

          <div className="flex flex-wrap gap-2">
            {readiness.needsOnboarding && (
              <Button
                onClick={() => openHostedFlow("onboard")}
                disabled={busy !== null}
              >
                <ExternalLink aria-hidden="true" />
                {busy === "onboard" ? "Opening Stripe…" : "Continue in Stripe"}
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => openHostedFlow("manage")}
              disabled={busy !== null}
            >
              <ExternalLink aria-hidden="true" />
              {busy === "manage" ? "Opening Stripe…" : "Manage in Stripe"}
            </Button>
          </div>
        </>
      )}

      <p className="text-xs text-slate-500">
        Transfers move funds to your connected Stripe balance. Stripe controls
        when money reaches your bank account.
      </p>
    </div>
  );
}
