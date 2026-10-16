import { AppShell } from "@/components/layout/app-shell";
import { CreditCardPage } from "@/components/credit-card/credit-card-page";

// Phone build Credit card. The page reads no search params, so no Suspense.
export default function MobileCreditCard() {
  return (
    <AppShell>
      <CreditCardPage />
    </AppShell>
  );
}
