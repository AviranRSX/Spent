"use client";

import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";

export const TRIP_KEYS = {
  overview: ["trips"] as const,
  detail: (id: number) => ["trip", id] as const,
  needs: ["trips-needs"] as const,
  memberships: ["trip-memberships"] as const,
};

const TRIP_DEPENDENT_KEYS = [
  ["trips"],
  ["trip"],
  ["trips-needs"],
  ["trip-memberships"],
  ["home"],
] as const;

/** Membership depends on assignments, trips and categories, so refresh all of it. */
export function useInvalidateTrips(): () => void {
  const queryClient = useQueryClient();
  return useCallback(() => {
    for (const queryKey of TRIP_DEPENDENT_KEYS) {
      void queryClient.invalidateQueries({ queryKey: [...queryKey] });
    }
  }, [queryClient]);
}
