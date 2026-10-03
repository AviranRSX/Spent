import "server-only";

import { getDb } from "../index";
import { normalizeCurrency } from "@/lib/currency";
import {
  resolveTripMembership,
  type MembershipAssignment,
  type MembershipReason,
  type MembershipResult,
  type MembershipTransaction,
  type MembershipTrip,
  type TripStatus,
} from "@/lib/trips/membership";
import { summarizeTrip, tripPhase } from "@/lib/trips/summary";
import type {
  NeedsTripItem,
  TransactionTripInfo,
  Trip,
  TripDetail,
  TripInput,
  TripPatch,
  TripRef,
  TripSummary,
  TripsOverview,
} from "@/lib/trips/types";

interface TripRow {
  id: number;
  name: string;
  country: string | null;
  currency: string;
  start_date: string;
  end_date: string;
  status: TripStatus;
  created_at: string;
  updated_at: string;
}

const TRIP_COLUMNS =
  "id, name, country, currency, start_date, end_date, status, created_at, updated_at";

function mapTrip(row: TripRow): Trip {
  return {
    id: row.id,
    name: row.name,
    country: row.country,
    currency: row.currency,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listTrips(workspaceId: number): Trip[] {
  const rows = getDb()
    .prepare(
      `SELECT ${TRIP_COLUMNS} FROM trips WHERE workspace_id = ?
       ORDER BY start_date DESC, id DESC`
    )
    .all(workspaceId) as TripRow[];
  return rows.map(mapTrip);
}

export function getTrip(workspaceId: number, id: number): Trip | null {
  const row = getDb()
    .prepare(`SELECT ${TRIP_COLUMNS} FROM trips WHERE workspace_id = ? AND id = ?`)
    .get(workspaceId, id) as TripRow | undefined;
  return row ? mapTrip(row) : null;
}

export function createTrip(
  workspaceId: number,
  input: TripInput,
  status: TripStatus = "confirmed"
): Trip {
  const result = getDb()
    .prepare(
      `INSERT INTO trips (workspace_id, name, country, currency, start_date, end_date, status)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      workspaceId,
      input.name,
      input.country,
      normalizeCurrency(input.currency),
      input.startDate,
      input.endDate,
      status
    );
  const trip = getTrip(workspaceId, Number(result.lastInsertRowid));
  if (!trip) throw new Error("Trip creation failed");
  return trip;
}

const PATCH_COLUMNS: ReadonlyArray<[keyof TripPatch, string]> = [
  ["name", "name"],
  ["country", "country"],
  ["currency", "currency"],
  ["startDate", "start_date"],
  ["endDate", "end_date"],
  ["status", "status"],
];

export function updateTrip(
  workspaceId: number,
  id: number,
  patch: TripPatch
): Trip | null {
  if (!getTrip(workspaceId, id)) return null;
  const sets: string[] = [];
  const values: (string | null)[] = [];
  for (const [key, column] of PATCH_COLUMNS) {
    const value = patch[key];
    if (value === undefined) continue;
    sets.push(`${column} = ?`);
    values.push(key === "currency" && value ? normalizeCurrency(value) : value);
  }
  if (sets.length > 0) {
    sets.push("updated_at = datetime('now')");
    getDb()
      .prepare(`UPDATE trips SET ${sets.join(", ")} WHERE workspace_id = ? AND id = ?`)
      .run(...values, workspaceId, id);
  }
  return getTrip(workspaceId, id);
}

export function deleteTrip(workspaceId: number, id: number): boolean {
  // trip_assignments rows for this trip go with it (ON DELETE CASCADE).
  const result = getDb()
    .prepare("DELETE FROM trips WHERE workspace_id = ? AND id = ?")
    .run(workspaceId, id);
  return result.changes > 0;
}

export function toMembershipTrip(trip: Trip): MembershipTrip {
  return {
    id: trip.id,
    currency: trip.currency,
    startDate: trip.startDate,
    endDate: trip.endDate,
    status: trip.status,
  };
}

function asConfirmed(trip: Trip): MembershipTrip {
  return { ...toMembershipTrip(trip), status: "confirmed" };
}

export function toTripRef(trip: Trip): TripRef {
  return {
    id: trip.id,
    name: trip.name,
    country: trip.country,
    currency: trip.currency,
    startDate: trip.startDate,
    endDate: trip.endDate,
  };
}

export interface TripTransactionRow extends MembershipTransaction {
  chargedAmount: number;
  originalAmount: number;
  status: "completed" | "pending";
  categoryId: number | null;
  categoryColor: string | null;
  categorySource: "ai" | "user" | null;
  parentName: string | null;
  parentColor: string | null;
}

/** Non-transfer rows of a workspace, optionally limited to some ids. */
export function loadTripTransactions(
  workspaceId: number,
  ids?: readonly number[]
): TripTransactionRow[] {
  const params: number[] = [workspaceId];
  let idFilter = "";
  if (ids) {
    if (ids.length === 0) return [];
    idFilter = ` AND t.id IN (${ids.map(() => "?").join(",")})`;
    params.push(...ids);
  }
  return getDb()
    .prepare(
      `SELECT t.id, substr(t.date, 1, 10) AS date,
              t.original_currency AS originalCurrency, t.kind, t.description,
              t.charged_amount AS chargedAmount, t.original_amount AS originalAmount,
              t.status, t.category_id AS categoryId, t.category_source AS categorySource,
              c.name AS categoryName, c.color AS categoryColor,
              p.name AS parentName, p.color AS parentColor
       FROM transactions t
       LEFT JOIN categories c ON c.id = t.category_id AND c.workspace_id = t.workspace_id
       LEFT JOIN categories p ON p.id = c.parent_id AND p.workspace_id = t.workspace_id
       WHERE t.workspace_id = ? AND t.kind != 'transfer'${idFilter}
       ORDER BY t.date, t.id`
    )
    .all(...params) as TripTransactionRow[];
}

export function listTripAssignments(workspaceId: number): MembershipAssignment[] {
  return getDb()
    .prepare(
      `SELECT transaction_id AS transactionId, trip_id AS tripId
       FROM trip_assignments WHERE workspace_id = ?`
    )
    .all(workspaceId) as MembershipAssignment[];
}

interface TripState {
  trips: Trip[];
  confirmed: Trip[];
  rows: TripTransactionRow[];
  assignments: MembershipAssignment[];
  memberships: Map<number, MembershipResult>;
}

function loadTripState(workspaceId: number): TripState {
  const trips = listTrips(workspaceId);
  const rows = loadTripTransactions(workspaceId);
  const assignments = listTripAssignments(workspaceId);
  return {
    trips,
    confirmed: trips.filter((trip) => trip.status === "confirmed"),
    rows,
    assignments,
    memberships: resolveTripMembership(rows, trips.map(toMembershipTrip), assignments),
  };
}

type MemberRow = TripTransactionRow & { reason: MembershipReason };

function groupMembers(
  rows: readonly TripTransactionRow[],
  memberships: ReadonlyMap<number, MembershipResult>
): Map<number, MemberRow[]> {
  const groups = new Map<number, MemberRow[]>();
  for (const row of rows) {
    const m = memberships.get(row.id);
    if (m?.kind !== "member") continue;
    const list = groups.get(m.tripId) ?? [];
    list.push({ ...row, reason: m.reason });
    groups.set(m.tripId, list);
  }
  return groups;
}

/** Membership for one trip; non-confirmed trips are previewed as if confirmed. */
function membersFor(state: TripState, trip: Trip): MemberRow[] {
  const memberships =
    trip.status === "confirmed"
      ? state.memberships
      : resolveTripMembership(
          state.rows,
          [...state.confirmed.map(toMembershipTrip), asConfirmed(trip)],
          state.assignments
        );
  return groupMembers(state.rows, memberships).get(trip.id) ?? [];
}

function countQueue(memberships: ReadonlyMap<number, MembershipResult>): number {
  let count = 0;
  for (const m of memberships.values()) if (m.kind === "queue") count += 1;
  return count;
}

function toSummary(trip: Trip, members: readonly MemberRow[]): TripSummary {
  const totals = summarizeTrip(trip, members);
  return {
    ...trip,
    total: totals.total,
    days: totals.days,
    perDay: totals.perDay,
    memberCount: totals.memberCount,
  };
}

export function getTripsOverview(workspaceId: number): TripsOverview {
  const state = loadTripState(workspaceId);
  const confirmedMembers = groupMembers(state.rows, state.memberships);
  return {
    confirmed: state.confirmed.map((trip) =>
      toSummary(trip, confirmedMembers.get(trip.id) ?? [])
    ),
    suggested: state.trips
      .filter((trip) => trip.status === "suggested")
      .map((trip) => toSummary(trip, membersFor(state, trip))),
    needsTripCount: countQueue(state.memberships),
  };
}

export function getTripDetail(workspaceId: number, id: number): TripDetail | null {
  const state = loadTripState(workspaceId);
  const trip = state.trips.find((t) => t.id === id);
  if (!trip) return null;
  const members = membersFor(state, trip);
  const totals = summarizeTrip(trip, members);
  return {
    trip,
    total: totals.total,
    days: totals.days,
    perDay: totals.perDay,
    before: totals.before,
    during: totals.during,
    pendingCount: totals.pendingCount,
    breakdown: totals.breakdown,
    daily: totals.daily,
    members: members.map((m) => ({
      id: m.id,
      date: m.date,
      description: m.description,
      chargedAmount: m.chargedAmount,
      originalAmount: m.originalAmount,
      originalCurrency: normalizeCurrency(m.originalCurrency),
      status: m.status,
      categoryId: m.categoryId,
      categoryName: m.categoryName,
      categoryColor: m.categoryColor,
      categorySource: m.categorySource,
      reason: m.reason,
      phase: tripPhase(m.date, trip.startDate),
    })),
    travelRecategorizableCount: members.filter(
      (m) => m.categoryName === "Travel" && m.categorySource !== "user"
    ).length,
  };
}

export type AssignTripResult =
  | { ok: true; count: number }
  | {
      ok: false;
      reason: "trip-not-found" | "trip-not-confirmed" | "unknown-transactions";
    };

function allTransactionsInWorkspace(
  workspaceId: number,
  transactionIds: readonly number[]
): boolean {
  const placeholders = transactionIds.map(() => "?").join(",");
  const row = getDb()
    .prepare(
      `SELECT COUNT(*) AS n FROM transactions
       WHERE workspace_id = ? AND id IN (${placeholders})`
    )
    .get(workspaceId, ...transactionIds) as { n: number };
  return row.n === new Set(transactionIds).size;
}

/** Manual decision: a confirmed trip, or null for "not part of any trip". */
export function setTripAssignments(
  workspaceId: number,
  transactionIds: readonly number[],
  tripId: number | null
): AssignTripResult {
  if (transactionIds.length === 0) return { ok: false, reason: "unknown-transactions" };
  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO trip_assignments (transaction_id, workspace_id, trip_id)
     VALUES (?, ?, ?)
     ON CONFLICT(transaction_id) DO UPDATE SET
       trip_id = excluded.trip_id,
       created_at = datetime('now')
     WHERE trip_assignments.workspace_id = excluded.workspace_id`
  );
  // Validation and writes share one transaction so a rejected batch writes nothing.
  return db.transaction((): AssignTripResult => {
    if (tripId !== null) {
      const trip = getTrip(workspaceId, tripId);
      if (!trip) return { ok: false, reason: "trip-not-found" };
      if (trip.status !== "confirmed") return { ok: false, reason: "trip-not-confirmed" };
    }
    if (!allTransactionsInWorkspace(workspaceId, transactionIds)) {
      return { ok: false, reason: "unknown-transactions" };
    }
    for (const id of transactionIds) upsert.run(id, workspaceId, tripId);
    return { ok: true, count: new Set(transactionIds).size };
  })();
}

/** Reverts transactions to the automatic rules. */
export function clearTripAssignments(
  workspaceId: number,
  transactionIds: readonly number[]
): number {
  if (transactionIds.length === 0) return 0;
  const placeholders = transactionIds.map(() => "?").join(",");
  return getDb()
    .prepare(
      `DELETE FROM trip_assignments
       WHERE workspace_id = ? AND transaction_id IN (${placeholders})`
    )
    .run(workspaceId, ...transactionIds).changes;
}

export function getNeedsTripQueue(workspaceId: number): NeedsTripItem[] {
  const state = loadTripState(workspaceId);
  const confirmedById = new Map(state.confirmed.map((t) => [t.id, t] as const));
  const items: NeedsTripItem[] = [];
  for (const row of state.rows) {
    const m = state.memberships.get(row.id);
    if (m?.kind !== "queue") continue;
    items.push({
      transaction: {
        id: row.id,
        date: row.date,
        description: row.description,
        chargedAmount: row.chargedAmount,
        originalAmount: row.originalAmount,
        originalCurrency: normalizeCurrency(row.originalCurrency),
        status: row.status,
        categoryName: row.categoryName,
        categoryColor: row.categoryColor,
      },
      cause: m.cause,
      suggestions: m.suggestedTripIds.flatMap((id) => {
        const trip = confirmedById.get(id);
        return trip ? [toTripRef(trip)] : [];
      }),
    });
  }
  return items.sort(
    (a, b) =>
      b.transaction.date.localeCompare(a.transaction.date) ||
      b.transaction.id - a.transaction.id
  );
}

export function getNeedsTripCount(workspaceId: number): number {
  return countQueue(loadTripState(workspaceId).memberships);
}

/** Trip info for specific rows (table badges and the category prompt). */
export function getTransactionTripInfo(
  workspaceId: number,
  transactionIds: readonly number[]
): Record<number, TransactionTripInfo> {
  const trips = listTrips(workspaceId);
  const tripsById = new Map(trips.map((t) => [t.id, t] as const));
  const rows = loadTripTransactions(workspaceId, transactionIds);
  const memberships = resolveTripMembership(
    rows,
    trips.map(toMembershipTrip),
    listTripAssignments(workspaceId)
  );
  const info: Record<number, TransactionTripInfo> = {};
  for (const id of transactionIds) {
    const m = memberships.get(id);
    if (!m || m.kind === "none") {
      info[id] = { kind: "none", manualNoTrip: m?.kind === "none" && m.manualNoTrip };
    } else if (m.kind === "member") {
      info[id] = {
        kind: "member",
        tripId: m.tripId,
        tripName: tripsById.get(m.tripId)?.name ?? "",
        reason: m.reason,
      };
    } else {
      info[id] = {
        kind: "queue",
        suggestions: m.suggestedTripIds.flatMap((tripId) => {
          const trip = tripsById.get(tripId);
          return trip ? [toTripRef(trip)] : [];
        }),
      };
    }
  }
  return info;
}
