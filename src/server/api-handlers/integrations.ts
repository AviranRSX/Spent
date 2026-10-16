import "server-only";

import { listBankCredentials } from "@/server/db/queries/bank-credentials";
import { getCredentialStats } from "@/server/db/queries/sync-runs";
import { ok, type HandlerContext } from "./types";

export function listIntegrationsHandler(ctx: HandlerContext) {
  const { workspaceId } = ctx;
  const creds = listBankCredentials(workspaceId);
  const items = creds.map((c) => {
    const stats = getCredentialStats(workspaceId, c.id, c.provider);
    return {
      id: c.id,
      provider: c.provider,
      label: c.label,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      lastSyncAt: stats.lastSyncAt,
      transactionCount: stats.transactionCount,
      requiresManualTwoFactor: c.requiresManualTwoFactor,
      hasTwoFactorToken: c.hasTwoFactorToken,
    };
  });
  return ok(items);
}
