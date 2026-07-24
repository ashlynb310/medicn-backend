import { Lock } from "lucide-react";
import { ButtonLink } from "@/components/ui/button-link";

interface SignInRequiredProps {
  /** What the user will be able to do once signed in. */
  message: string;
  /** Where to return after signing in (informational for now). */
  returnTo?: string;
}

/**
 * Placeholder shown on authenticated routes until Supabase auth is wired.
 * It does NOT grant access or fake data — it directs the user to sign in.
 * When auth lands, gate the real content behind the session and render this
 * only when there is no access token.
 */
export default function SignInRequired({
  message,
  returnTo,
}: SignInRequiredProps) {
  const loginHref = returnTo
    ? `/login?returnTo=${encodeURIComponent(returnTo)}`
    : "/login";

  return (
    <div className="flex flex-col items-center gap-4 rounded-xl border border-slate-200 bg-slate-50 px-6 py-16 text-center">
      <span className="flex size-12 items-center justify-center rounded-full bg-slate-900 text-white">
        <Lock className="size-5" aria-hidden="true" />
      </span>
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-slate-900">
          Sign in to continue
        </h2>
        <p className="max-w-md text-sm text-slate-600">{message}</p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <ButtonLink href={loginHref}>Log in</ButtonLink>
        <ButtonLink href="/signup" variant="outline">
          Create an account
        </ButtonLink>
      </div>
    </div>
  );
}
