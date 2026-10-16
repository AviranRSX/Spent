import "server-only";

import {
  getNeedsTripQueue,
  getTransactionTripInfo,
  getTripDetail,
  getTripsOverview,
} from "@/server/db/queries/trips";
import { parseTransactionIds, parseTripId } from "@/lib/trips/validation";
import { fail, ok, type HandlerContext } from "./types";

export function getTripsHandler(ctx: HandlerContext) {
  return ok(getTripsOverview(ctx.workspaceId));
}

export function getTripDetailHandler(ctx: HandlerContext) {
  const id = parseTripId(ctx.params.id);
  if (id == null) return fail(400, "invalid id");
  const detail = getTripDetail(ctx.workspaceId, id);
  if (!detail) return fail(404, "not found");
  return ok(detail);
}

export function getNeedsTripHandler(ctx: HandlerContext) {
  return ok({ items: getNeedsTripQueue(ctx.workspaceId) });
}

export function getTripMembershipsHandler(ctx: HandlerContext) {
  const ids = parseTransactionIds(ctx.query.getAll("ids").map(Number));
  if (!ids) return ok({});
  return ok(getTransactionTripInfo(ctx.workspaceId, ids));
}
