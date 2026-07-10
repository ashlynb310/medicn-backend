"use client";

import SignInRequired from "@/components/auth/sign-in-required";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/components/auth/auth-provider";

interface AuthGateProps {
  /** Message shown in the sign-in prompt when logged out. */
  message: string;
  returnTo?: string;
  /** Rendered only when the user is authenticated. */
  children: React.ReactNode;
}

/**
 * Client-side auth guard. While the session resolves it shows a skeleton; when
 * logged out it renders SignInRequired; when logged in it renders children.
 * This is a UX gate, not a security boundary — the backend still enforces auth
 * on every protected request via the bearer token.
 */
export default function AuthGate({ message, returnTo, children }: AuthGateProps) {
  const { status } = useAuth();

  if (status === "loading") {
    return (
      <div className="flex flex-col gap-3" aria-busy="true" aria-live="polite">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (status !== "authenticated") {
    return <SignInRequired message={message} returnTo={returnTo} />;
  }

  return <>{children}</>;
}
