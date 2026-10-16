import { getWorkspaceIdFromRequest } from "@/server/lib/workspace-context";
import { getHomeHandler } from "@/server/api-handlers/home";
import { getSummaryHandler } from "@/server/api-handlers/summary";
import {
  getAccountNumbersHandler,
  getTransactionsHandler,
  getTransactionsSummaryHandler,
} from "@/server/api-handlers/transactions";
import {
  getCategoriesHandler,
  getCategoryDetailHandler,
} from "@/server/api-handlers/categories";
import {
  getNeedsTripHandler,
  getTripDetailHandler,
  getTripMembershipsHandler,
  getTripsHandler,
} from "@/server/api-handlers/trips";
import { listWorkspacesHandler } from "@/server/api-handlers/workspaces";
import { listIntegrationsHandler } from "@/server/api-handlers/integrations";
import { approveTransaction, putTransactionCategory } from "./local-writes";
import type { HandlerContext, HandlerResult } from "@/server/api-handlers/types";
import type { ActivitySnapshot } from "@/lib/types";

type Handler = (ctx: HandlerContext) => HandlerResult<unknown>;

interface Route {
  pattern: RegExp;
  /** Names for the pattern's capture groups, in order. */
  params?: string[];
  handler: Handler;
  /** False for routes that do not read a workspace (they still work with none). */
  scoped?: boolean;
}

// The phone has no sync, scheduler or Ollama, so activity is always idle.
const IDLE_ACTIVITY: ActivitySnapshot = {
  sync: { active: false, since: null, kind: null, stale: false },
  scheduler: { armed: false, nextRunAt: null },
  ollama: { running: false, spawnedBySpent: false },
};

// GET only. Order matters: fixed trip paths come before /api/trips/:id.
const ROUTES: Route[] = [
  { pattern: /^\/api\/home$/, handler: getHomeHandler },
  { pattern: /^\/api\/summary$/, handler: getSummaryHandler },
  { pattern: /^\/api\/transactions$/, handler: getTransactionsHandler },
  { pattern: /^\/api\/transactions\/summary$/, handler: getTransactionsSummaryHandler },
  { pattern: /^\/api\/transactions\/account-numbers$/, handler: getAccountNumbersHandler },
  { pattern: /^\/api\/categories$/, handler: getCategoriesHandler },
  {
    pattern: /^\/api\/categories\/([^/]+)\/detail$/,
    params: ["id"],
    handler: getCategoryDetailHandler,
  },
  { pattern: /^\/api\/trips$/, handler: getTripsHandler },
  { pattern: /^\/api\/trips\/needs-trip$/, handler: getNeedsTripHandler },
  { pattern: /^\/api\/trips\/memberships$/, handler: getTripMembershipsHandler },
  { pattern: /^\/api\/trips\/([^/]+)$/, params: ["id"], handler: getTripDetailHandler },
  { pattern: /^\/api\/workspaces$/, handler: listWorkspacesHandler, scoped: false },
  { pattern: /^\/api\/integrations$/, handler: listIntegrationsHandler },
  { pattern: /^\/api\/activity$/, handler: () => ({ status: 200, body: IDLE_ACTIVITY }), scoped: false },
];

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const TRANSACTION_WRITE = /^\/api\/transactions\/(\d+)$/;

/** The phone's only writes. Returns null for anything else (404 follows). */
async function handleTransactionWrite(
  method: string,
  id: number,
  parsed: URL,
  init?: RequestInit
): Promise<Response | null> {
  let body: { categoryId?: unknown; approve?: unknown } = {};
  try {
    body = JSON.parse(String(init?.body ?? "{}")) ?? {};
  } catch {
    body = {};
  }
  try {
    const workspaceId = getWorkspaceIdFromRequest(
      new Request(parsed, { headers: init?.headers })
    );
    if (method === "PUT") {
      if (typeof body.categoryId !== "number" || !body.categoryId) {
        return json({ error: "categoryId is required" }, 400);
      }
      return await putTransactionCategory(workspaceId, id, body.categoryId);
    }
    if (body.approve === true) return await approveTransaction(workspaceId, id);
    return null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
}

/** Answers the client's /api/* calls in-process from the local snapshot. */
export async function handleMobileRequest(url: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  const parsed = new URL(url, "http://phone.local");
  const path = parsed.pathname;

  const write = TRANSACTION_WRITE.exec(path);
  if (write && (method === "PUT" || method === "PATCH")) {
    const response = await handleTransactionWrite(method, Number(write[1]), parsed, init);
    if (response) return response;
  }

  const route =
    method === "GET" ? ROUTES.find((r) => r.pattern.test(path)) : undefined;
  if (!route) {
    return json({ error: `Not available on the phone: ${method} ${path}` }, 404);
  }

  try {
    const match = route.pattern.exec(path);
    const params: Record<string, string> = {};
    route.params?.forEach((name, i) => {
      params[name] = decodeURIComponent(match?.[i + 1] ?? "");
    });
    const ctx: HandlerContext = {
      // Same rule as desktop: a valid header id, else the lowest id. Its getDb
      // is the sql.js snapshot on the phone.
      workspaceId:
        route.scoped === false
          ? 0
          : getWorkspaceIdFromRequest(new Request(parsed, { headers: init?.headers })),
      query: parsed.searchParams,
      params,
      now: new Date(),
      nextScheduledSync: null,
    };
    const result = route.handler(ctx);
    return json(result.body, result.status);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return json({ error: message }, 500);
  }
}
