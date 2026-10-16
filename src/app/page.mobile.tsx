import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { HomePage } from "@/components/home/home-page";

// Phone build Home. Suspense is required because HomePage reads search
// params, which a static export only knows in the browser. Loading the
// snapshot and installing the in-process API transport comes with the
// phone boot (Task 14).
export default function MobileHome() {
  return (
    <Suspense>
      <AppShell>
        <HomePage dataSourceMode="xlsx" />
      </AppShell>
    </Suspense>
  );
}
