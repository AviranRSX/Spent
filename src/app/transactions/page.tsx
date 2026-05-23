import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { TransactionsPage } from "@/components/transactions/transactions-page";
import { canOpenAnyWorkspace } from "@/server/setup/access";

export const dynamic = "force-dynamic";

export default function Transactions() {
  if (!canOpenAnyWorkspace()) {
    redirect("/setup");
  }
  return (
    <AppShell>
      <TransactionsPage />
    </AppShell>
  );
}
