import { AppShell } from "@/components/layout/app-shell";
import { Dashboard } from "@/components/dashboard/dashboard";

// Phone build Budget. Dashboard reads no search params, so no Suspense.
export default function MobileBudget() {
  return (
    <AppShell>
      <Dashboard />
    </AppShell>
  );
}
