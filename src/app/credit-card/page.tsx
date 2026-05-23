import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { CreditCardPage } from "@/components/credit-card/credit-card-page";
import { canOpenAnyWorkspace } from "@/server/setup/access";

export const dynamic = "force-dynamic";

export default function CreditCard() {
  if (!canOpenAnyWorkspace()) {
    redirect("/setup");
  }

  return (
    <AppShell>
      <CreditCardPage />
    </AppShell>
  );
}
