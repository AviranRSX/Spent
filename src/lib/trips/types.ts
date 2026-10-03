import type { MembershipReason, TripStatus } from "./membership";
import type {
  TripCategorySlice,
  TripDailyPoint,
  TripPhase,
  TripTotals,
} from "./summary";

export type {
  MembershipReason,
  TripStatus,
  TripCategorySlice,
  TripDailyPoint,
  TripPhase,
};

export interface Trip {
  id: number;
  name: string;
  country: string | null;
  currency: string;
  startDate: string;
  endDate: string;
  status: TripStatus;
  createdAt: string;
  updatedAt: string;
}

export interface TripRef {
  id: number;
  name: string;
  country: string | null;
  currency: string;
  startDate: string;
  endDate: string;
}

export interface TripSummary extends Trip {
  total: number;
  days: number;
  perDay: number;
  memberCount: number;
}

export interface TripsOverview {
  confirmed: TripSummary[];
  suggested: TripSummary[];
  needsTripCount: number;
}

export interface TripMember {
  id: number;
  date: string;
  description: string;
  chargedAmount: number;
  originalAmount: number;
  /** Normalized ISO code; the stored raw value is never rewritten. */
  originalCurrency: string;
  status: "completed" | "pending";
  categoryId: number | null;
  categoryName: string | null;
  categoryColor: string | null;
  categorySource: "ai" | "user" | null;
  reason: MembershipReason;
  phase: TripPhase;
}

export type TripDetail = Omit<TripTotals, "memberCount"> & {
  trip: Trip;
  members: TripMember[];
  travelRecategorizableCount: number;
};

export interface NeedsTripItem {
  transaction: {
    id: number;
    date: string;
    description: string;
    chargedAmount: number;
    originalAmount: number;
    originalCurrency: string;
    status: "completed" | "pending";
    categoryName: string | null;
    categoryColor: string | null;
  };
  cause: "travel-category" | "ambiguous";
  suggestions: TripRef[];
}

export type TransactionTripInfo =
  | {
      kind: "member";
      tripId: number;
      tripName: string;
      reason: MembershipReason;
    }
  | { kind: "queue"; suggestions: TripRef[] }
  | { kind: "none"; manualNoTrip: boolean };

export interface TripInput {
  name: string;
  country: string | null;
  currency: string;
  startDate: string;
  endDate: string;
}

export type TripPatch = Partial<TripInput> & { status?: TripStatus };
