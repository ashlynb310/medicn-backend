"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";
import { callApi } from "../../../lib/api";
import {
  createSupabaseBrowserClient,
  hasSupabaseConfig
} from "../../../lib/supabase/client";

const userTypeOptions = [
  { label: "Renter", value: "renter" },
  { label: "Host", value: "host" }
] as const;

const healthcareRoleOptions = [
  { label: "Medical Student", value: "medical_student" },
  { label: "Nursing Student", value: "nursing_student" },
  { label: "Nurse", value: "nurse" },
  { label: "Resident physician", value: "resident_physician" },
  { label: "Physician", value: "physician" },
  { label: "Other", value: "other" }
] as const;

type SignupUserType = (typeof userTypeOptions)[number]["value"];
type SignupHealthcareRole = (typeof healthcareRoleOptions)[number]["value"];

export default function SignUpPage() {
  const router = useRouter();
  const [userType, setUserType] = useState<SignupUserType>("renter");
  const [healthcareRole, setHealthcareRole] = useState<
    SignupHealthcareRole | ""
  >("");
  const [email, setEmail] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (!hasSupabaseConfig) {
    return (
      <p className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-700">
        Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
        to enable Supabase sign-up.
      </p>
    );
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setMessage(null);

    try {
      const supabase = createSupabaseBrowserClient();
      const trimmedFirstName = firstName.trim();
      const trimmedLastName = lastName.trim();
      const trimmedDisplayName = displayName.trim();
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: {
          data: {
            user_type: userType,
            healthcare_role: healthcareRole || undefined,
            first_name: trimmedFirstName || undefined,
            last_name: trimmedLastName || undefined,
            display_name: trimmedDisplayName || undefined
          }
        }
      });

      if (error) {
        throw error;
      }

      if (data.session) {
        await callApi("/auth/sync", data.session.access_token, {
          method: "POST"
        });
        router.push("/dashboard");
        return;
      }

      setMessage("Check your email to confirm the account before signing in.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Sign up failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="max-w-md space-y-4">
      <h1 className="text-2xl font-semibold">Sign up</h1>
      <form
        className="space-y-4 rounded-md border border-slate-200 bg-white p-4"
        onSubmit={handleSubmit}
      >
        <fieldset>
          <legend className="text-sm font-medium text-slate-700">
            User type
          </legend>
          <div className="mt-1 grid grid-cols-2 gap-2" role="radiogroup">
            {userTypeOptions.map((option) => (
              <label
                className={`flex cursor-pointer items-center justify-center rounded-md border px-3 py-2 text-sm font-medium ${
                  userType === option.value
                    ? "border-slate-900 bg-slate-900 text-white"
                    : "border-slate-300 bg-white text-slate-900"
                }`}
                key={option.value}
              >
                <input
                  checked={userType === option.value}
                  className="sr-only"
                  name="userType"
                  onChange={() => setUserType(option.value)}
                  type="radio"
                  value={option.value}
                />
                {option.label}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="block text-sm font-medium text-slate-700">
          Healthcare role
          <select
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            onChange={(event) =>
              setHealthcareRole(event.target.value as SignupHealthcareRole)
            }
            required
            value={healthcareRole}
          >
            <option value="">Select...</option>
            {healthcareRoleOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
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
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-slate-700">
            First name
            <input
              autoComplete="given-name"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              onChange={(event) => setFirstName(event.target.value)}
              required
              type="text"
              value={firstName}
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Last name
            <input
              autoComplete="family-name"
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              onChange={(event) => setLastName(event.target.value)}
              required
              type="text"
              value={lastName}
            />
          </label>
        </div>
        <label className="block text-sm font-medium text-slate-700">
          Display name
          <input
            autoComplete="nickname"
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            onChange={(event) => setDisplayName(event.target.value)}
            required
            type="text"
            value={displayName}
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Password
          <input
            autoComplete="new-password"
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
          {loading ? "Creating..." : "Create account"}
        </button>
        {message ? <p className="text-sm text-slate-700">{message}</p> : null}
      </form>
      <p className="text-sm text-slate-700">
        Already have an account?{" "}
        <Link className="font-medium underline" href="/sign-in">
          Sign in
        </Link>
      </p>
    </section>
  );
}
