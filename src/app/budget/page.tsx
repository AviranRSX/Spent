import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Dashboard } from "@/components/dashboard/dashboard";
import { canOpenAnyWorkspace } from "@/server/setup/access";

export const dynamic = "force-dynamic";

export default function BudgetPage() {
  if (!canOpenAnyWorkspace()) {
    redirect("/setup");
  }

  return (
    <AppShell>
      <Dashboard />
    </AppShell>
  );
}
