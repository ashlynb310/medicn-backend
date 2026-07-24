-- Rename the external auth provider mapping from Clerk to Supabase Auth.
ALTER TABLE "User" RENAME COLUMN "clerkUserId" TO "supabaseUserId";

ALTER INDEX "User_clerkUserId_key" RENAME TO "User_supabaseUserId_key";
ALTER INDEX "User_clerkUserId_idx" RENAME TO "User_supabaseUserId_idx";
