import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { TripsPage } from "@/components/trips/trips-page";

// Phone build Trips. Suspense is required because the page reads search
// params, which a static export only knows in the browser.
export default function MobileTrips() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <TripsPage />
      </Suspense>
    </AppShell>
  );
}
