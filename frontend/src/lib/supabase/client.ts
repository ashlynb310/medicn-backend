import {
  createClient,
  type SupabaseClient,
} from "@supabase/supabase-js";

// The MediCN backend delegates authentication to Supabase Auth: the frontend
// obtains a Supabase access token (login/signup) and sends it to the backend as
// `Authorization: Bearer <token>` (see medicn/apps/api/src/auth). Only the
// browser-safe publishable key and URL are used here — never a secret key.

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();

/** True only when both browser-safe Supabase env vars are present. */
export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseKey);

let client: SupabaseClient | null = null;

/**
 * Returns the singleton browser Supabase client, or null when Supabase is not
 * configured. Callers must handle the null case with an honest "auth not
 * configured" message rather than pretending auth works.
 */
export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured) {
    return null;
  }

  if (!client) {
    client = createClient(supabaseUrl!, supabaseKey!, {
      auth: {
        // Local-dev appropriate session storage: persisted in localStorage and
        // auto-refreshed by the SDK. No secrets are stored.
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    });
  }

  return client;
}
