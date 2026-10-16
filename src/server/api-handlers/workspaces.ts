import "server-only";

import { listWorkspaces } from "@/server/db/queries/workspaces";
import { ok, type HandlerContext } from "./types";

export function listWorkspacesHandler(ctx: HandlerContext) {
  void ctx;
  return ok(listWorkspaces());
}
