import "server-only";

import { getDb } from "@/server/db/index";
import {
  createTrip,
  listTripAssignments,
  listTrips,
  loadTripTransactions,
  toMembershipTrip,
} from "@/server/db/queries/trips";
import { resolveTripMembership } from "@/lib/trips/membership";
import {
  clusterTripCandidates,
  selectDetectionCandidates,
  suggestedTripName,
} from "@/lib/trips/detection";
import type { Trip } from "@/lib/trips/types";

/** Inserts a suggested trip for each new foreign-currency cluster. */
export function detectTripSuggestions(workspaceId: number): Trip[] {
  const db = getDb();
  return db.transaction(() => {
    const trips = listTrips(workspaceId);
    const rows = loadTripTransactions(workspaceId);
    const memberships = resolveTripMembership(
      rows,
      trips.map(toMembershipTrip),
      listTripAssignments(workspaceId)
    );
    const clusters = clusterTripCandidates(
      selectDetectionCandidates(rows, memberships),
      trips
    );
    return clusters.map((cluster) => {
      const { name, country } = suggestedTripName(cluster);
      return createTrip(
        workspaceId,
        {
          name,
          country: country || null,
          currency: cluster.currency,
          startDate: cluster.startDate,
          endDate: cluster.endDate,
        },
        "suggested"
      );
    });
  })();
}

/** For sync and import hooks: detection must never fail the main flow. */
export function runTripDetectionSafely(workspaceId: number): number {
  try {
    return detectTripSuggestions(workspaceId).length;
  } catch (err) {
    console.error(
      `Trip detection failed for workspace ${workspaceId}:`,
      err instanceof Error ? err.message : "unknown error"
    );
    return 0;
  }
}
