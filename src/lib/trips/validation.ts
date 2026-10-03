import { normalizeCurrency } from "../currency";
import { isIsoDay } from "./dates";
import type { TripStatus } from "./membership";
import type { TripInput, TripPatch } from "./types";

export type TripInputError =
  | "invalidBody"
  | "nameRequired"
  | "nameTooLong"
  | "countryTooLong"
  | "currencyInvalid"
  | "dateInvalid"
  | "dateOrder"
  | "statusInvalid"
  | "empty";

export type TripParseResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: TripInputError };

export const MAX_TRIP_NAME = 80;
export const MAX_TRIP_COUNTRY = 60;
export const MAX_TRANSACTION_IDS = 1000;

const TRIP_STATUSES: readonly TripStatus[] = ["suggested", "confirmed", "dismissed"];

const fail = (error: TripInputError): { ok: false; error: TripInputError } => ({
  ok: false,
  error,
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseName(raw: unknown): TripParseResult<string> {
  if (typeof raw !== "string" || raw.trim() === "") return fail("nameRequired");
  const name = raw.trim();
  if (name.length > MAX_TRIP_NAME) return fail("nameTooLong");
  return { ok: true, value: name };
}

function parseCountry(raw: unknown): TripParseResult<string | null> {
  if (raw == null) return { ok: true, value: null };
  if (typeof raw !== "string") return fail("invalidBody");
  const country = raw.trim();
  if (country.length > MAX_TRIP_COUNTRY) return fail("countryTooLong");
  return { ok: true, value: country === "" ? null : country };
}

function parseCurrency(raw: unknown): TripParseResult<string> {
  if (typeof raw !== "string" || raw.trim() === "") return fail("currencyInvalid");
  const code = normalizeCurrency(raw);
  return /^[A-Z]{3}$/.test(code) ? { ok: true, value: code } : fail("currencyInvalid");
}

function parseDay(raw: unknown): TripParseResult<string> {
  return typeof raw === "string" && isIsoDay(raw)
    ? { ok: true, value: raw }
    : fail("dateInvalid");
}

function parseStatus(raw: unknown): TripParseResult<TripStatus> {
  return typeof raw === "string" && (TRIP_STATUSES as readonly string[]).includes(raw)
    ? { ok: true, value: raw as TripStatus }
    : fail("statusInvalid");
}

export function parseTripInput(
  body: unknown
): TripParseResult<{ input: TripInput; status: TripStatus }> {
  if (!isRecord(body)) return fail("invalidBody");
  const name = parseName(body.name);
  if (!name.ok) return name;
  const country = parseCountry(body.country);
  if (!country.ok) return country;
  const currency = parseCurrency(body.currency);
  if (!currency.ok) return currency;
  const startDate = parseDay(body.startDate);
  if (!startDate.ok) return startDate;
  const endDate = parseDay(body.endDate);
  if (!endDate.ok) return endDate;
  if (endDate.value < startDate.value) return fail("dateOrder");
  const status: TripParseResult<TripStatus> =
    body.status === undefined ? { ok: true, value: "confirmed" } : parseStatus(body.status);
  if (!status.ok) return status;
  return {
    ok: true,
    value: {
      input: {
        name: name.value,
        country: country.value,
        currency: currency.value,
        startDate: startDate.value,
        endDate: endDate.value,
      },
      status: status.value,
    },
  };
}

export function parseTripPatch(
  body: unknown,
  current: { startDate: string; endDate: string }
): TripParseResult<TripPatch> {
  if (!isRecord(body)) return fail("invalidBody");
  const patch: TripPatch = {};
  if ("name" in body) {
    const r = parseName(body.name);
    if (!r.ok) return r;
    patch.name = r.value;
  }
  if ("country" in body) {
    const r = parseCountry(body.country);
    if (!r.ok) return r;
    patch.country = r.value;
  }
  if ("currency" in body) {
    const r = parseCurrency(body.currency);
    if (!r.ok) return r;
    patch.currency = r.value;
  }
  if ("startDate" in body) {
    const r = parseDay(body.startDate);
    if (!r.ok) return r;
    patch.startDate = r.value;
  }
  if ("endDate" in body) {
    const r = parseDay(body.endDate);
    if (!r.ok) return r;
    patch.endDate = r.value;
  }
  if ("status" in body) {
    const r = parseStatus(body.status);
    if (!r.ok) return r;
    patch.status = r.value;
  }
  if (Object.keys(patch).length === 0) return fail("empty");
  const start = patch.startDate ?? current.startDate;
  const end = patch.endDate ?? current.endDate;
  if (end < start) return fail("dateOrder");
  return { ok: true, value: patch };
}

export function parseTransactionIds(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_TRANSACTION_IDS) {
    return null;
  }
  const valid = raw.every(
    (value) => typeof value === "number" && Number.isInteger(value) && value > 0
  );
  return valid ? [...new Set(raw as number[])] : null;
}

export function parseAssignmentBody(
  body: unknown
): { transactionIds: number[]; tripId: number | null } | null {
  if (!isRecord(body) || !("tripId" in body)) return null;
  const transactionIds = parseTransactionIds(body.transactionIds);
  if (!transactionIds) return null;
  const tripId = body.tripId;
  if (tripId === null) return { transactionIds, tripId: null };
  if (typeof tripId === "number" && Number.isInteger(tripId) && tripId > 0) {
    return { transactionIds, tripId };
  }
  return null;
}

export function parseTripId(raw: string): number | null {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}
