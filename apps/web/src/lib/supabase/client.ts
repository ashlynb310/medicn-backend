import { createBrowserClient } from "@supabase/ssr";

export const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
export const supabasePublishableKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export const hasSupabaseConfig = Boolean(
  supabaseUrl && supabasePublishableKey
);

export function createSupabaseBrowserClient() {
  if (!supabaseUrl || !supabasePublishableKey) {
    throw new Error("Supabase client environment variables are not configured.");
  }

  return createBrowserClient(supabaseUrl, supabasePublishableKey);
}
