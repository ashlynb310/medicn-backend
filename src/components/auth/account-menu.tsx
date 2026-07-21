"use client";

import { useRouter } from "next/navigation";
import {
  CalendarDays,
  ChevronDown,
  LayoutDashboard,
  LogOut,
  MessagesSquare,
  Shield,
  User,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useAuth } from "@/components/auth/auth-provider";
import { useUnreadInquiries } from "@/components/messaging/use-unread-inquiries";
import { avatarColorClass, avatarInitials } from "@/lib/avatar";

function isRenderableImageUrl(
  value: string | null | undefined
): value is string {
  return !!value && (value.startsWith("https://") || value.startsWith("http://"));
}

/** Account dropdown shown in the header when a user is logged in. */
export default function AccountMenu() {
  const router = useRouter();
  const { user, email, signOut } = useAuth();
  // Real unread total from the backend inbox + realtime notifications.
  const { total: unreadTotal } = useUnreadInquiries();

  const label =
    user?.displayName || user?.firstName || email || "Account";
  const profilePhotoUrl = user?.profilePhotoUrl;
  const isHost = user?.roles.includes("host") ?? false;
  // Discoverability only — the admin area and backend enforce the role. This
  // link merely reflects an already-granted role; it never grants one.
  const isAdmin = user?.roles.includes("admin") ?? false;

  const handleSignOut = async () => {
    await signOut();
    router.push("/");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <span
          className={`flex size-7 items-center justify-center overflow-hidden rounded-full text-xs font-bold ring-1 ring-slate-200 ${
            isRenderableImageUrl(profilePhotoUrl)
              ? "bg-slate-100"
              : `${avatarColorClass(label)} text-white`
          }`}
        >
          {isRenderableImageUrl(profilePhotoUrl) ? (
            // eslint-disable-next-line @next/next/no-img-element -- Supabase storage host is environment-dependent.
            <img
              src={profilePhotoUrl}
              alt=""
              className="size-full object-cover"
            />
          ) : (
            avatarInitials(label)
          )}
        </span>
        <span className="hidden max-w-[10rem] truncate text-sm font-medium sm:inline">
          {label}
        </span>
        <ChevronDown className="size-4 text-slate-400" aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="truncate">{email}</DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={() => router.push("/messages")}>
          <MessagesSquare aria-hidden="true" />
          Messages
          {unreadTotal > 0 && (
            <span
              className="ml-auto rounded-full bg-sky-600 px-1.5 py-0.5 text-xs font-semibold text-white"
              aria-label={`${unreadTotal} unread messages`}
            >
              {unreadTotal}
            </span>
          )}
        </DropdownMenuItem>
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
        {isAdmin && (
          <DropdownMenuItem onClick={() => router.push("/admin/listings")}>
            <Shield aria-hidden="true" />
            Listing moderation
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={handleSignOut}>
          <LogOut aria-hidden="true" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
