import "server-only";

import {
  getTransactionsSummary,
  listTransactionAccountNumbers,
  queryTransactions,
  type TransactionKindFilter,
} from "@/server/db/queries/transactions";
import type { TransactionSourceType } from "@/lib/transaction-source-types";
import { fail, ok, type HandlerContext } from "./types";

function parseKind(raw: string | null): TransactionKindFilter | undefined {
  if (raw === "expense" || raw === "income" || raw === "all") {
    return raw;
  }
  return undefined;
}

function parseSourceType(raw: string | null): TransactionSourceType | undefined {
  if (raw === "bank" || raw === "card" || raw === "all") {
    return raw;
  }
  return undefined;
}

export function getTransactionsHandler(ctx: HandlerContext) {
  const { workspaceId } = ctx;
  const searchParams = ctx.query;

  // Support multi-id filter ("?categoryIds=1&categoryIds=2") for parent
  // category drilldowns (parent expands to its children client-side).
  const categoryIds = searchParams
    .getAll("categoryIds")
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n));

  const credentialIds = searchParams
    .getAll("credentialIds")
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n > 0);

  const accountNumbers = searchParams
    .getAll("accountNumbers")
    .map((v) => v.trim())
    .filter((v) => v.length > 0);

  const result = queryTransactions(workspaceId, {
    from: searchParams.get("from") ?? undefined,
    to: searchParams.get("to") ?? undefined,
    search: searchParams.get("search") ?? undefined,
    category: searchParams.has("category")
      ? Number(searchParams.get("category"))
      : undefined,
    categoryIds: categoryIds.length > 0 ? categoryIds : undefined,
    sort: searchParams.get("sort") ?? undefined,
    order: (searchParams.get("order") as "asc" | "desc") ?? undefined,
    limit: searchParams.has("limit")
      ? Number(searchParams.get("limit"))
      : undefined,
    offset: searchParams.has("offset")
      ? Number(searchParams.get("offset"))
      : undefined,
    kind: parseKind(searchParams.get("kind")),
    provider: searchParams.get("provider") ?? undefined,
    sourceType: parseSourceType(searchParams.get("sourceType")),
    needsReview: searchParams.get("needsReview") === "true",
    uncategorized: searchParams.get("uncategorized") === "true",
    lowConfidence: searchParams.get("lowConfidence") === "true",
    credentialIds: credentialIds.length > 0 ? credentialIds : undefined,
    accountNumbers: accountNumbers.length > 0 ? accountNumbers : undefined,
  });

  return ok(result);
}

export function getTransactionsSummaryHandler(ctx: HandlerContext) {
  const { workspaceId } = ctx;
  const searchParams = ctx.query;
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (!from || !to) {
    return fail(400, "from and to are required");
  }

  const credentialIds = searchParams
    .getAll("credentialIds")
    .map((v) => Number(v))
    .filter((n) => Number.isFinite(n) && n > 0);

  return ok(
    getTransactionsSummary(workspaceId, from, to, {
      credentialIds: credentialIds.length > 0 ? credentialIds : undefined,
      sourceType: parseSourceType(searchParams.get("sourceType")),
    })
  );
}

export function getAccountNumbersHandler(ctx: HandlerContext) {
  const searchParams = ctx.query;
  return ok(
    listTransactionAccountNumbers(ctx.workspaceId, {
      from: searchParams.get("from") ?? undefined,
      to: searchParams.get("to") ?? undefined,
      sourceType: parseSourceType(searchParams.get("sourceType")),
    })
  );
}
