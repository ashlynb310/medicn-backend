"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import PageContainer from "@/components/layout/page-container";
import PageHeader from "@/components/layout/page-header";
import SignInRequired from "@/components/auth/sign-in-required";
import ErrorState from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth/auth-provider";
import { formatEnumLabel } from "@/lib/listing-format";

// Read-only profile view backed by GET /auth/me (loaded by the auth provider).
// Editing (PATCH /users/me) is intentionally deferred to a later phase.
export default function AccountPage() {
  const router = useRouter();
  const { status, user, profileStatus, email, signOut, refreshProfile } =
    useAuth();

  useEffect(() => {
    // Re-fetch the profile on mount so a hard refresh shows fresh data.
    if (status === "authenticated") {
      void refreshProfile();
    }
  }, [status, refreshProfile]);

  if (status === "loading") {
    return (
      <PageContainer width="narrow">
        <Skeleton className="h-9 w-48" />
        <Skeleton className="h-40 w-full" />
      </PageContainer>
    );
  }

  if (status !== "authenticated") {
    return (
      <PageContainer width="narrow">
        <PageHeader title="Your profile" />
        <SignInRequired
          message="Sign in to view your MediCN profile."
          returnTo="/account"
        />
      </PageContainer>
    );
  }

  const handleSignOut = async () => {
    await signOut();
    router.push("/");
  };

  const rows: Array<{ label: string; value: string | null }> = [
    { label: "Email", value: email },
    { label: "First name", value: user?.firstName ?? null },
    { label: "Last name", value: user?.lastName ?? null },
    { label: "Display name", value: user?.displayName ?? null },
    {
      label: "Healthcare role",
      value: user?.healthcareRole ? formatEnumLabel(user.healthcareRole) : null,
    },
    { label: "Phone", value: user?.phoneNumber ?? null },
  ];

  return (
    <PageContainer width="narrow">
      <PageHeader
        title="Your profile"
        description="Your MediCN account details."
        actions={
          <Button variant="outline" onClick={handleSignOut}>
            Log out
          </Button>
        }
      />

      {profileStatus === "error" ? (
        <ErrorState
          title="Profile unavailable"
          message="You are signed in, but we could not load your MediCN profile. The API may be offline."
          action={
            <Button variant="outline" onClick={() => void refreshProfile()}>
              Retry
            </Button>
          }
        />
      ) : profileStatus === "loading" ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="flex flex-col gap-4 rounded-xl border border-slate-200 p-5">
          <div className="flex flex-wrap items-center gap-2">
            {(user?.roles ?? []).length > 0 ? (
              user!.roles.map((role) => (
                <Badge key={role} tone="info">
                  {formatEnumLabel(role)}
                </Badge>
              ))
            ) : (
              <Badge tone="neutral">No role assigned</Badge>
            )}
            {user?.emailVerified ? (
              <Badge tone="success">Email verified</Badge>
            ) : (
              <Badge tone="warning">Email not verified</Badge>
            )}
          </div>
          <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
            {rows.map((row) => (
              <div key={row.label} className="flex flex-col">
                <dt className="text-xs font-medium uppercase tracking-wide text-slate-400">
                  {row.label}
                </dt>
                <dd className="text-sm text-slate-800">
                  {row.value || <span className="text-slate-400">—</span>}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      )}
    </PageContainer>
  );
}
