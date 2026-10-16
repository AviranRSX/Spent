"use client";

import { Fragment } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  assignTransactionsToTrip,
  getCategories,
  getTripMemberships,
  updateTransactionCategory,
} from "@/lib/api";
import { groupCategoryOptions } from "@/lib/category-options";
import { translateCategoryName } from "@/lib/i18n-data";
import type { TripMember } from "@/lib/trips/types";
import type { Category } from "@/lib/types";
import { useInvalidateTrips } from "./use-trip-actions";

interface TripMemberCategoryPickerProps {
  tripId: number;
  member: TripMember;
}

export function TripMemberCategoryPicker({ tripId, member }: TripMemberCategoryPickerProps) {
  const t = useTranslations("trips");
  const tCat = useTranslations("categoriesSeeded");
  const tSettings = useTranslations("settings.categories");
  const queryClient = useQueryClient();
  const invalidateTrips = useInvalidateTrips();

  // Same key as the transactions table, so both share one cached list.
  const categoriesQuery = useQuery({
    queryKey: ["categories", member.kind],
    queryFn: () => getCategories(member.kind),
  });
  const groups = groupCategoryOptions(categoriesQuery.data ?? []);

  const keepInTrip = useMutation({
    mutationFn: () => assignTransactionsToTrip([member.id], tripId),
    onSuccess: () => {
      invalidateTrips();
      toast.success(t("detail.keptInTripToast"));
    },
    onError: () => toast.error(t("errorToast")),
  });

  const change = useMutation({
    mutationFn: async (category: Category) => {
      await updateTransactionCategory(member.id, category.id);
      // Membership partly depends on the category (travel leaves, online
      // merchants), so the row can leave this trip after the change.
      const info = await getTripMemberships([member.id]).catch(() => null);
      const entry = info?.[member.id];
      return { category, left: entry != null && !(entry.kind === "member" && entry.tripId === tripId) };
    },
    onSuccess: ({ category, left }) => {
      invalidateTrips();
      queryClient.invalidateQueries({ queryKey: ["transactions"] });
      queryClient.invalidateQueries({ queryKey: ["summary"] });
      queryClient.invalidateQueries({ queryKey: ["transactions-summary"] });
      const name = translateCategoryName(category.name, tCat);
      if (left) {
        toast(t("detail.categoryChangedLeftToast", { category: name }), {
          duration: 10000,
          action: { label: t("detail.keepInTrip"), onClick: () => keepInTrip.mutate() },
        });
      } else {
        toast.success(t("detail.categoryChangedToast", { category: name }));
      }
    },
    onError: () => toast.error(t("errorToast")),
  });

  const label = member.categoryName
    ? translateCategoryName(member.categoryName, tCat)
    : t("detail.uncategorized");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="inline-flex rounded-4xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        disabled={change.isPending}
        aria-label={t("detail.changeCategory", { category: label })}
        title={t("detail.changeCategoryHint")}
      >
        <Badge
          variant="outline"
          className="cursor-pointer transition-colors hover:bg-accent"
          style={
            member.categoryColor
              ? {
                  borderColor: member.categoryColor + "40",
                  backgroundColor: member.categoryColor + "15",
                  color: member.categoryColor,
                }
              : undefined
          }
        >
          {label}
          <ChevronDown className="size-3 opacity-60" aria-hidden="true" />
        </Badge>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-80 w-56 overflow-y-auto">
        {groups.map((group, index) => (
          <Fragment key={group.parentName ?? "__ungrouped"}>
            {index > 0 ? <DropdownMenuSeparator /> : null}
            <DropdownMenuGroup>
              <DropdownMenuLabel>
                {group.parentName
                  ? translateCategoryName(group.parentName, tCat)
                  : tSettings("ungrouped")}
              </DropdownMenuLabel>
              {group.options.map((cat) => (
                <DropdownMenuItem
                  key={cat.id}
                  disabled={cat.id === member.categoryId}
                  onClick={() => change.mutate(cat)}
                >
                  <span
                    className="me-2 size-2 shrink-0 rounded-full"
                    style={{ backgroundColor: cat.color }}
                    aria-hidden="true"
                  />
                  {translateCategoryName(cat.name, tCat)}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
