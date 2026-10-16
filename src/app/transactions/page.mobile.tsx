import { Suspense } from "react";
import { AppShell } from "@/components/layout/app-shell";
import { TransactionsPage } from "@/components/transactions/transactions-page";

// Phone build Transactions. Suspense is required because the page reads
// search params, which a static export only knows in the browser.
export default function MobileTransactions() {
  return (
    <AppShell>
      <Suspense fallback={null}>
        <TransactionsPage />
      </Suspense>
    </AppShell>
  );
}
