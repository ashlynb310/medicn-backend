"use client";

import { useRouter } from "next/navigation";
import { CalendarDays, ChevronDown, LayoutDashboard, LogOut, User } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/components/auth/auth-provider";

function initialsFrom(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "U";
}

/** Account dropdown shown in the header when a user is logged in. */
export default function AccountMenu() {
  const router = useRouter();
  const { user, email, signOut } = useAuth();

  const label =
    user?.displayName || user?.firstName || email || "Account";
  const isHost = user?.roles.includes("host") ?? false;

  const handleSignOut = async () => {
    await signOut();
    router.push("/");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span className="flex size-7 items-center justify-center rounded-full bg-slate-900 text-xs font-bold text-white">
          {initialsFrom(label)}
        </span>
        <span className="hidden max-w-[10rem] truncate text-sm font-medium sm:inline">
          {label}
        </span>
        <ChevronDown className="size-4 text-slate-400" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuLabel className="truncate">{email}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/bookings")}>
          <CalendarDays aria-hidden="true" />
          My Bookings
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push("/host")}>
          <LayoutDashboard aria-hidden="true" />
          {isHost ? "Host dashboard" : "Become a host"}
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => router.push("/account")}>
          <User aria-hidden="true" />
          Profile
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={handleSignOut}>
          <LogOut aria-hidden="true" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
