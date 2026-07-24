"use client";

import { ShieldX } from "lucide-react";
import { useAuth } from "@/components/auth/auth-provider";
import ErrorState from "@/components/ui/error-state";
import { Skeleton } from "@/components/ui/skeleton";

interface AdminOperationsIdentity {
  user: { id: string };
  accessToken: string | null;
}

export default function AdminOperationsAccess({
  children,
}: {
  children: (identity: AdminOperationsIdentity) => React.ReactNode;
}) {
  const {
    status,
    profileStatus,
    user,
    sessionUserId,
    accessToken,
  } = useAuth();

  if (status === "loading") {
    return <Skeleton className="h-64 w-full" />;
  }

  if (status !== "authenticated") {
    return (
      <ErrorState
        title="Sign in to inspect operations"
        message="Operational monitoring is available only to authenticated administrators."
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
        message="Your authenticated profile must be available before operational monitoring can load."
      />
    );
  }

  if (!user.roles.includes("admin")) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-6 py-14 text-center">
        <ShieldX className="size-9 text-amber-600" aria-hidden="true" />
        <h2 className="text-lg font-semibold text-amber-900">
          Administrator access required
        </h2>
        <p className="max-w-md text-sm text-amber-800">
          This area is limited to MediCN administrators. The backend verifies
          authorization for every operational request.
        </p>
      </div>
    );
  }

  return children({ user: { id: user.id }, accessToken });
}
