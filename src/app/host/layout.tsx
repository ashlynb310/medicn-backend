"use client";

import { LayoutDashboard, List, SquarePlus } from "lucide-react";
import DashboardLayout, {
  type DashboardNavItem,
} from "@/components/layout/dashboard-layout";

const hostNav: DashboardNavItem[] = [
  { label: "Overview", href: "/host", icon: LayoutDashboard, exact: true },
  { label: "My Listings", href: "/host/listings", icon: List, exact: true },
  { label: "New Listing", href: "/host/listings/new", icon: SquarePlus },
];

export default function HostLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DashboardLayout title="Host" nav={hostNav}>
      {children}
    </DashboardLayout>
  );
}
