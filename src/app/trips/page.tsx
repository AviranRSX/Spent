import { Suspense } from "react";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { TripsPage } from "@/components/trips/trips-page";
import { canOpenAnyWorkspace } from "@/server/setup/access";

export const dynamic = "force-dynamic";

export default function Trips() {
  if (!canOpenAnyWorkspace()) {
    redirect("/setup");
  }
  return (
    <AppShell>
      <Suspense fallback={null}>
        <TripsPage />
      </Suspense>
    </AppShell>
  );
}
