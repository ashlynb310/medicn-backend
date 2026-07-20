"use client";

import type { Session } from "@supabase/supabase-js";
import type { CurrentUserDto } from "@medicn/types";
import Link from "next/link";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { ApiRequestError, callApi } from "../../lib/api";
import {
  createSupabaseBrowserClient,
  hasSupabaseConfig
} from "../../lib/supabase/client";

const healthcareRoleOptions = [
  { label: "Medical Student", value: "medical_student" },
  { label: "Nursing Student", value: "nursing_student" },
  { label: "Nurse", value: "nurse" },
  { label: "Resident physician", value: "resident_physician" },
  { label: "Physician", value: "physician" },
  { label: "Other", value: "other" }
] as const;

export default function DashboardPage() {
  if (!hasSupabaseConfig) {
    return (
      <section className="space-y-3">
        <h1 className="text-2xl font-semibold">Auth dashboard</h1>
        <p className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-700">
          Supabase is not configured. Add NEXT_PUBLIC_SUPABASE_URL and
          NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to enable frontend auth testing.
        </p>
      </section>
    );
  }

  return <ConfiguredDashboard />;
}

function ConfiguredDashboard() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const [session, setSession] = useState<Session | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [result, setResult] = useState<string>("Loading profile...");
  const [loading, setLoading] = useState(false);
  const [currentUser, setCurrentUser] = useState<CurrentUserDto | null>(null);
  const [profileForm, setProfileForm] = useState({
    firstName: "",
    lastName: "",
    displayName: "",
    healthcareRole: "",
    healthcareAffiliation: "",
    phoneNumber: "",
    bio: "",
    profilePhotoUrl: ""
  });

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (active) {
        setSession(data.session);
        if (!data.session) {
          setCurrentUser(null);
        }
        setIsLoaded(true);
      }
    });

    const { data: authListener } = supabase.auth.onAuthStateChange(
      (_event, nextSession) => {
        setSession(nextSession);
        if (!nextSession) {
          setCurrentUser(null);
        }
        setIsLoaded(true);
      }
    );

    return () => {
      active = false;
      authListener.subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (!session) {
      return;
    }

    let active = true;
    const accessToken = session.access_token;

    async function ensureProfileSynced() {
      setLoading(true);
      setResult("Loading profile...");

      try {
        const currentUser = await callApi<CurrentUserDto>(
          "/auth/me",
          accessToken
        );

        if (active) {
          setCurrentUser(currentUser.data);
          updateProfileFormFromUser(currentUser.data);
          setResult(JSON.stringify(currentUser, null, 2));
        }
      } catch (error) {
        if (error instanceof ApiRequestError && error.code === "USER_NOT_SYNCED") {
          try {
            const syncedUser = await callApi<CurrentUserDto>(
              "/auth/sync",
              accessToken,
              {
                method: "POST"
              }
            );

            if (active) {
              setCurrentUser(syncedUser.data);
              updateProfileFormFromUser(syncedUser.data);
              setResult(JSON.stringify(syncedUser, null, 2));
            }
          } catch (syncError) {
            if (active) {
              setResult(
                syncError instanceof Error ? syncError.message : "Unknown error"
              );
            }
          } finally {
            if (active) {
              setLoading(false);
            }
          }

          return;
        }

        if (active) {
          setResult(error instanceof Error ? error.message : "Unknown error");
          setLoading(false);
        }
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }

    void ensureProfileSynced();

    return () => {
      active = false;
    };
  }, [session]);

  async function signOut() {
    await supabase.auth.signOut();
    setCurrentUser(null);
    setResult("Signed out.");
  }

  async function updateProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setResult("Saving profile...");

    try {
      const token = session?.access_token ?? null;
      const response = await callApi<CurrentUserDto>("/users/me", token, {
        method: "PATCH",
        body: profileForm
      });
      setCurrentUser(response.data);
      updateProfileFormFromUser(response.data);
      setResult(JSON.stringify(response, null, 2));
    } catch (error) {
      setResult(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  function updateProfileField(
    field: keyof typeof profileForm,
    value: string
  ) {
    setProfileForm((current) => ({
      ...current,
      [field]: value
    }));
  }

  function updateProfileFormFromUser(user: CurrentUserDto | null) {
    if (!user) {
      return;
    }

    setProfileForm({
      firstName: user.firstName ?? "",
      lastName: user.lastName ?? "",
      displayName: user.displayName ?? "",
      healthcareRole: user.healthcareRole ?? "",
      healthcareAffiliation: user.healthcareAffiliation ?? "",
      phoneNumber: user.phoneNumber ?? "",
      bio: user.bio ?? "",
      profilePhotoUrl: user.profilePhotoUrl ?? ""
    });
  }

  if (!isLoaded) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">Auth dashboard</h1>
        <p className="rounded-md border border-slate-200 bg-white p-4 text-sm text-slate-700">
          Loading...
        </p>
      </section>
    );
  }

  if (!session) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-semibold">Auth dashboard</h1>
        <div className="rounded-md border border-slate-200 bg-white p-4">
          <p className="mb-3 text-sm text-slate-700">
            Sign in to continue.
          </p>
          <Link
            className="inline-flex rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white"
            href="/sign-in"
          >
            Sign in
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-semibold">Auth dashboard</h1>
      {currentUser && !currentUser.emailVerified ? (
        <div
          className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
          role="status"
        >
          <p className="font-medium">Email not verified</p>
          <p className="mt-1">
            Confirm your email to unlock contact, booking, payment, and host
            publishing features when those flows are added.
          </p>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <button
          className="rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900"
          onClick={signOut}
          type="button"
        >
          Sign out
        </button>
      </div>
      <form
        className="space-y-4 rounded-md border border-slate-200 bg-white p-4"
        onSubmit={updateProfile}
      >
        <h2 className="text-base font-semibold">Profile</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-sm font-medium text-slate-700">
            First name
            <input
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              onChange={(event) =>
                updateProfileField("firstName", event.target.value)
              }
              type="text"
              value={profileForm.firstName}
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Last name
            <input
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              onChange={(event) =>
                updateProfileField("lastName", event.target.value)
              }
              type="text"
              value={profileForm.lastName}
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Display name
            <input
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              onChange={(event) =>
                updateProfileField("displayName", event.target.value)
              }
              type="text"
              value={profileForm.displayName}
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Healthcare role
            <select
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              onChange={(event) =>
                updateProfileField("healthcareRole", event.target.value)
              }
              value={profileForm.healthcareRole}
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
            Healthcare affiliation
            <input
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              onChange={(event) =>
                updateProfileField(
                  "healthcareAffiliation",
                  event.target.value
                )
              }
              type="text"
              value={profileForm.healthcareAffiliation}
            />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Phone number
            <input
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
              onChange={(event) =>
                updateProfileField("phoneNumber", event.target.value)
              }
              type="tel"
              value={profileForm.phoneNumber}
            />
          </label>
        </div>
        <label className="block text-sm font-medium text-slate-700">
          Profile photo URL
          <input
            className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2"
            onChange={(event) =>
              updateProfileField("profilePhotoUrl", event.target.value)
            }
            type="url"
            value={profileForm.profilePhotoUrl}
          />
        </label>
        <label className="block text-sm font-medium text-slate-700">
          Bio
          <textarea
            className="mt-1 min-h-28 w-full rounded-md border border-slate-300 px-3 py-2"
            onChange={(event) => updateProfileField("bio", event.target.value)}
            value={profileForm.bio}
          />
        </label>
        <button
          className="rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          disabled={loading}
          type="submit"
        >
          {loading ? "Saving..." : "Save profile"}
        </button>
      </form>
      <pre className="overflow-auto rounded-md border border-slate-200 bg-white p-4 text-sm">
        {result}
      </pre>
    </section>
  );
}
