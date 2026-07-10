"use client";

// Dev-only auth diagnostics. Renders a "not available" notice outside
// development so a production build never exposes this surface. It never prints
// the access token or any secret — only presence/length and honest state.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CircleCheck, CircleMinus, CircleX, LoaderCircle } from "lucide-react";
import PageContainer from "@/components/layout/page-container";
import PageHeader from "@/components/layout/page-header";
import SectionHeading from "@/components/layout/section-heading";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/components/auth/auth-provider";
import { getApiBaseUrl, ApiError, toErrorMessage } from "@/lib/api/client";
import { getCurrentUser, syncCurrentUser } from "@/lib/api/auth";
import type { CurrentUser } from "@/lib/api/auth";

const IS_DEV = process.env.NODE_ENV === "development";

type CallState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; data: CurrentUser }
  | { status: "error"; code: string; message: string };

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 py-2 last:border-b-0">
      <dt className="text-sm font-medium text-slate-600">{label}</dt>
      <dd className="text-sm text-slate-900">{children}</dd>
    </div>
  );
}

function BoolBadge({
  value,
  yes = "Yes",
  no = "No",
}: {
  value: boolean;
  yes?: string;
  no?: string;
}) {
  return (
    <Badge tone={value ? "success" : "neutral"}>
      {value ? (
        <CircleCheck className="size-3.5" aria-hidden="true" />
      ) : (
        <CircleMinus className="size-3.5" aria-hidden="true" />
      )}
      {value ? yes : no}
    </Badge>
  );
}

function CallResult({ state }: { state: CallState }) {
  if (state.status === "idle") {
    return <p className="text-sm text-slate-500">Not called yet.</p>;
  }
  if (state.status === "loading") {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-600">
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        Calling…
      </p>
    );
  }
  if (state.status === "error") {
    return (
      <div
        role="alert"
        className="flex flex-col gap-2 rounded-lg border border-red-200 bg-red-50 p-3"
      >
        <p className="flex items-center gap-2 text-sm font-semibold text-red-800">
          <CircleX className="size-4" aria-hidden="true" />
          {state.code}
        </p>
        <p className="text-sm text-red-700">{state.message}</p>
        {state.code === "USER_NOT_SYNCED" && (
          <p className="text-xs text-red-700">
            The Supabase user has no MediCN profile yet. Call <b>/auth/sync</b>{" "}
            to create or update it from the Supabase user metadata, then retry
            /auth/me.
          </p>
        )}
        {(state.code === "NETWORK_ERROR" || state.code === "INVALID_RESPONSE") && (
          <p className="text-xs text-red-700">
            The backend at <code>{getApiBaseUrl()}</code> appears unavailable.
            Start it with <code>npm run dev:api</code> (and <code>npm run db:up</code>).
          </p>
        )}
      </div>
    );
  }
  return (
    <pre className="max-h-72 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs text-slate-800">
      {JSON.stringify(state.data, null, 2)}
    </pre>
  );
}

export default function DevAuthPage() {
  const router = useRouter();
  const {
    status,
    configured,
    email,
    emailConfirmedAt,
    accessToken,
    user,
    profileStatus,
    refreshSession,
    signOut,
  } = useAuth();

  const [meState, setMeState] = useState<CallState>({ status: "idle" });
  const [syncState, setSyncState] = useState<CallState>({ status: "idle" });
  const [sessionMsg, setSessionMsg] = useState<string | null>(null);

  if (!IS_DEV) {
    return (
      <PageContainer width="narrow">
        <PageHeader title="Auth diagnostics" />
        <p className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-sm text-slate-600">
          This diagnostics page is only available in development.
        </p>
      </PageContainer>
    );
  }

  const runCall = async (
    fn: (token: string) => Promise<CurrentUser>,
    set: (s: CallState) => void
  ) => {
    if (!accessToken) {
      set({
        status: "error",
        code: "NO_TOKEN",
        message: "No access token — sign in first.",
      });
      return;
    }
    set({ status: "loading" });
    try {
      const data = await fn(accessToken);
      set({ status: "ok", data });
    } catch (error) {
      if (error instanceof ApiError) {
        set({ status: "error", code: error.code, message: error.message });
      } else {
        set({
          status: "error",
          code: "UNKNOWN",
          message: toErrorMessage(error),
        });
      }
    }
  };

  const handleRefreshSession = async () => {
    setSessionMsg(null);
    const result = await refreshSession();
    setSessionMsg(
      result.ok ? "Session refreshed." : `Refresh failed: ${result.message}`
    );
  };

  const statusLabel =
    status === "loading"
      ? "Loading"
      : status === "authenticated"
        ? "Logged in"
        : status === "not_configured"
          ? "Not configured"
          : "Logged out";

  return (
    <PageContainer width="narrow">
      <PageHeader
        title="Auth diagnostics"
        description="Dev-only readiness check for the Supabase + backend auth wiring. Tokens are never displayed."
        eyebrow={<Badge tone="warning">development only</Badge>}
      />

      <section className="flex flex-col gap-3 rounded-xl border border-slate-200 p-5">
        <SectionHeading title="Environment & session" />
        <dl className="flex flex-col">
          <Row label="Supabase configured">
            <BoolBadge value={configured} />
          </Row>
          <Row label="API base URL">
            <code className="text-xs">{getApiBaseUrl()}</code>
          </Row>
          <Row label="Auth status">
            <Badge tone={status === "authenticated" ? "success" : "neutral"}>
              {statusLabel}
            </Badge>
          </Row>
          <Row label="User email">
            {email ?? <span className="text-slate-400">—</span>}
          </Row>
          <Row label="Email confirmed (Supabase)">
            {emailConfirmedAt ? (
              <Badge tone="success">
                <CircleCheck className="size-3.5" aria-hidden="true" />
                {new Date(emailConfirmedAt).toLocaleString()}
              </Badge>
            ) : status === "authenticated" ? (
              <Badge tone="warning">Not confirmed</Badge>
            ) : (
              <span className="text-slate-400">—</span>
            )}
          </Row>
          <Row label="Access token present">
            <BoolBadge value={Boolean(accessToken)} />
          </Row>
          <Row label="Profile load state">
            <Badge
              tone={
                profileStatus === "ready"
                  ? "success"
                  : profileStatus === "error"
                    ? "danger"
                    : "neutral"
              }
            >
              {profileStatus}
            </Badge>
          </Row>
          {user && (
            <Row label="MediCN roles">
              {user.roles.length > 0 ? user.roles.join(", ") : "none"}
            </Row>
          )}
        </dl>
        {status === "authenticated" && !emailConfirmedAt && (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
            Email is not verified. This is shown for transparency and does not
            block frontend work. The backend may still reject specific actions
            (e.g. checkout) with <code>EMAIL_NOT_VERIFIED</code> — that real
            error will be surfaced when it happens.
          </p>
        )}
      </section>

      <section className="flex flex-col gap-3 rounded-xl border border-slate-200 p-5">
        <SectionHeading title="Actions" />
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={handleRefreshSession} disabled={!configured}>
            Refresh Supabase session
          </Button>
          <Button
            variant="outline"
            onClick={() => runCall(getCurrentUser, setMeState)}
          >
            Call /auth/me
          </Button>
          <Button
            variant="outline"
            onClick={() => runCall(syncCurrentUser, setSyncState)}
          >
            Call /auth/sync
          </Button>
          <Button
            variant="destructive"
            onClick={async () => {
              await signOut();
              router.refresh();
            }}
          >
            Sign out
          </Button>
        </div>
        {sessionMsg && <p className="text-sm text-slate-600">{sessionMsg}</p>}
      </section>

      <section className="flex flex-col gap-2 rounded-xl border border-slate-200 p-5">
        <SectionHeading
          title="GET /auth/me"
          description="Returns the synced MediCN profile for the current token."
        />
        <CallResult state={meState} />
      </section>

      <section className="flex flex-col gap-2 rounded-xl border border-slate-200 p-5">
        <SectionHeading
          title="POST /auth/sync"
          description="Upserts the MediCN profile from Supabase metadata, then returns it."
        />
        <CallResult state={syncState} />
      </section>
    </PageContainer>
  );
}
