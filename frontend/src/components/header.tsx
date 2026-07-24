// src/components/header.tsx — primary site navigation.
"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Menu, X } from "lucide-react";
import Dropdown from "@/components/dropdown";
import { ButtonLink } from "@/components/ui/button-link";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useAuth } from "@/components/auth/auth-provider";
import AccountMenu from "@/components/auth/account-menu";

// Primary nav links available to everyone. Bookings requires auth; until
// Supabase auth is wired, the bookings page shows a sign-in prompt rather than
// data (see src/app/bookings/page.tsx).
//
// Future logged-in state: replace the Log in / Sign up actions below with an
// account menu (profile, dashboard, sign out) once auth exists. The primary
// links stay the same, so only the right-hand auth actions need to swap.
const primaryLinks = [
  { label: "Search Listings", href: "/search" },
  { label: "Become a Host", href: "/host" },
  { label: "My Bookings", href: "/bookings" },
];

export default function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { status, signOut } = useAuth();
  const isAuthenticated = status === "authenticated";
  const authResolved = status !== "loading";

  return (
    <header className="sticky top-0 z-50 w-full border-b border-slate-200 bg-white px-6 py-4">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
        {/* Logo */}
        <Link
          href="/"
          aria-label="Homepage"
          className="flex shrink-0 items-center gap-3"
        >
          <Image
            src="/600x600_Placeholder_Image.svg"
            alt="MediCN logo"
            width={54}
            height={36}
            className="h-9 w-auto"
            priority
          />
        </Link>

        {/* Desktop nav */}
        <nav
          aria-label="Primary"
          className="hidden items-center gap-5 md:flex"
        >
          {primaryLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="text-slate-700 transition-colors hover:text-slate-900"
            >
              {link.label}
            </Link>
          ))}
          <Dropdown />
          <span className="h-5 w-px bg-slate-200" aria-hidden="true" />
          {/* Auth actions: swap by session state. Render nothing until the
              session resolves to avoid a logged-out/in flash. */}
          {!authResolved ? (
            <span
              aria-hidden="true"
              className="h-7 w-24 animate-pulse rounded-lg bg-slate-100"
            />
          ) : isAuthenticated ? (
            <AccountMenu />
          ) : (
            <>
              <Link
                href="/login"
                className="text-slate-700 transition-colors hover:text-slate-900"
              >
                Log In
              </Link>
              <ButtonLink href="/signup">Sign Up</ButtonLink>
            </>
          )}
        </nav>

        {/* Mobile menu toggle */}
        <button
          type="button"
          onClick={() => setMobileOpen((open) => !open)}
          aria-expanded={mobileOpen}
          aria-controls="mobile-nav"
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          className="inline-flex size-9 items-center justify-center rounded-lg text-slate-700 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring md:hidden"
        >
          {mobileOpen ? <X className="size-5" /> : <Menu className="size-5" />}
        </button>
      </div>

      {/* Mobile nav panel */}
      <nav
        id="mobile-nav"
        aria-label="Primary"
        className={cn(
          "mx-auto mt-3 max-w-7xl flex-col gap-1 md:hidden",
          mobileOpen ? "flex" : "hidden"
        )}
      >
        {primaryLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            onClick={() => setMobileOpen(false)}
            className="rounded-lg px-3 py-2 text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            {link.label}
          </Link>
        ))}
        <div className="my-2 h-px bg-slate-200" aria-hidden="true" />
        {isAuthenticated ? (
          <>
            <Link
              href="/account"
              onClick={() => setMobileOpen(false)}
              className="rounded-lg px-3 py-2 text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              Profile
            </Link>
            <Button
              variant="ghost"
              onClick={() => {
                setMobileOpen(false);
                void signOut();
              }}
              className="mx-1 justify-start px-3 text-slate-700"
            >
              Log Out
            </Button>
          </>
        ) : (
          <>
            <Link
              href="/login"
              onClick={() => setMobileOpen(false)}
              className="rounded-lg px-3 py-2 text-slate-700 transition-colors hover:bg-slate-100 hover:text-slate-900"
            >
              Log In
            </Link>
            <ButtonLink
              href="/signup"
              onClick={() => setMobileOpen(false)}
              className="mx-3 mt-1 justify-center"
            >
              Sign Up
            </ButtonLink>
          </>
        )}
      </nav>
    </header>
  );
}
