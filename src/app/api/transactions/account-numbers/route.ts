import { NextResponse } from "next/server";
import { listTransactionAccountNumbers } from "@/server/db/queries/transactions";
import type { TransactionSourceType } from "@/lib/transaction-source-types";
import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";

function parseSourceType(raw: string | null): TransactionSourceType | undefined {
  if (raw === "bank" || raw === "card" || raw === "all") {
    return raw;
  }
  return undefined;
}

export async function GET(request: Request) {
  const workspaceId = getWorkspaceIdFromRequest(request);
  const { searchParams } = new URL(request.url);

  const accountNumbers = listTransactionAccountNumbers(workspaceId, {
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
    sourceType: parseSourceType(searchParams.get("sourceType")),
  });

  return NextResponse.json(accountNumbers);
}
