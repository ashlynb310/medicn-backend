import type { Metadata } from "next";
import Link from "next/link";
import { hasSupabaseConfig } from "../lib/supabase/client";
import "./globals.css";

export const metadata: Metadata = {
  title: "MediCN",
  description: "MediCN Supabase auth integration shell"
};

export default function RootLayout({
  children
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <header className="border-b border-slate-200 bg-white">
          <nav className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
            <Link className="font-semibold" href="/">
              MediCN
            </Link>
            <div className="flex items-center gap-4 text-sm">
              <Link href="/dashboard">Dashboard</Link>
              <Link href="/sign-in">Sign in</Link>
              <Link href="/sign-up">Sign up</Link>
              {!hasSupabaseConfig ? (
                <span className="text-slate-600">Supabase not configured</span>
              ) : null}
            </div>
          </nav>
        </header>
        <main className="mx-auto max-w-5xl px-4 py-8">{children}</main>
      </body>
    </html>
  );
}
