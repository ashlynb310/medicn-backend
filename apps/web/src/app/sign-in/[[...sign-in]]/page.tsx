"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import {
  createSupabaseBrowserClient,
  hasSupabaseConfig
} from "../../../lib/supabase/client";

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!hasSupabaseConfig) {
    return (
      <p className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-700">
        Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
        to enable Supabase sign-in.
      </p>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const supabase = createSupabaseBrowserClient();
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password
      });

      if (error) {
        throw error;
      }

      router.push("/dashboard");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sign in failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="max-w-md space-y-4">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <form
        className="space-y-4 rounded-md border border-slate-200 bg-white p-4"
        onSubmit={handleSubmit}
      >
        <label className="block text-sm font-medium text-slate-700">
          Email
          <input
            autoComplete="email"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            onChange={(event) => setEmail(event.target.value)}
            required
            type="email"
            value={email}
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Password
          <input
            autoComplete="current-password"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            minLength={8}
            onChange={(event) => setPassword(event.target.value)}
            required
            type="password"
            value={password}
          />
        </label>
        <button
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          disabled={loading}
          type="submit"
        >
          {loading ? "Signing in..." : "Sign in"}
        </button>
        {message ? <p className="text-sm text-red-700">{message}</p> : null}
      </form>
      <p className="text-sm text-slate-700">
        Need an account?{" "}
        <Link className="font-medium underline" href="/sign-up">
          Sign up
        </Link>
      </p>
    </section>
  );
}
