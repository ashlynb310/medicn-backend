"use client";

import {
  Activity,
  ArrowRightLeft,
  CircleDollarSign,
  ListChecks,
  TerminalSquare,
} from "lucide-react";
import DashboardLayout, {
  type DashboardNavItem,
} from "@/components/layout/dashboard-layout";

const operationsNav: DashboardNavItem[] = [
  { label: "Status", href: "/admin/operations", icon: Activity, exact: true },
  { label: "Payments", href: "/admin/operations/payments", icon: CircleDollarSign },
  { label: "Host transfers", href: "/admin/operations/transfers", icon: ArrowRightLeft },
  { label: "Job executions", href: "/admin/operations/jobs", icon: ListChecks },
  { label: "Commands", href: "/admin/operations/commands", icon: TerminalSquare },
];

export default function AdminOperationsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <DashboardLayout title="Admin operations" nav={operationsNav}>
      {children}
    </DashboardLayout>
  );
}
