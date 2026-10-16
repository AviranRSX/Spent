import "server-only";

import type { HandlerContext } from "@/server/api-handlers/types";
import { getWorkspaceIdFromRequest } from "./workspace-context";

/** Builds the framework-free handler context from a desktop route request. */
export function buildHandlerContext(
  request: Request,
  params: Record<string, string> = {},
  nextScheduledSync: string | null = null
): HandlerContext {
  return {
    workspaceId: getWorkspaceIdFromRequest(request),
    query: new URL(request.url).searchParams,
    params,
    now: new Date(),
    nextScheduledSync,
  };
}
