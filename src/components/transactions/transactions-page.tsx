"use client";

import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CreditCard, HelpCircle, Landmark, WalletCards, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { PageHeader } from "@/components/layout/app-shell";
import { TransactionsTable } from "@/components/dashboard/transactions-table";
import { PeriodSelector } from "@/components/dashboard/period-selector";
import { AINotConnectedBanner } from "@/components/ai-not-connected-banner";
import { KpiCards } from "./kpi-cards";
import { WidgetsRow } from "./widgets-row";
import {
  getCategories,
  getTransactions,
  getTransactionsSummary,
  listIntegrations,
} from "@/lib/api";
import type { TransactionKindFilter } from "@/lib/api";
import { expandCategoryFilterIds } from "@/lib/transaction-filters";
import {
  nextSortState,
  type SortOrder,
  type TransactionSortField,
} from "@/lib/transaction-sort";
import {
  addMonths,
  formatMonthLabel,
  getMonthRange,
} from "@/lib/formatters";
import type { TransactionSourceType } from "@/lib/transaction-source-types";
import {
  isPendingReviewFilter,
  serializeReviewFilter,
  type TransactionReviewFilter,
} from "@/lib/transaction-review-filter";
import type { Locale } from "@/i18n/routing";

export function TransactionsPage() {
  const t = useTranslations("transactions");
  const locale = useLocale() as Locale;
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<number[]>([]);
  const [accountFilter, setAccountFilter] = useState<number[]>([]);
  const [page, setPage] = useState(0);
  const [kind, setKind] = useState<TransactionKindFilter>("expense");
  const [sourceType, setSourceType] = useState<TransactionSourceType>("all");
  const [reviewFilter, setReviewFilter] =
    useState<TransactionReviewFilter>("all");
  const [sortField, setSortField] = useState<TransactionSortField>("date");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const filterOptions: { value: TransactionKindFilter; label: string }[] = [
    { value: "all", label: t("filterAll") },
    { value: "income", label: t("filterIncome") },
    { value: "expense", label: t("filterExpenses") },
  ];
  const sourceOptions: {
    value: TransactionSourceType;
    label: string;
    icon: typeof WalletCards;
  }[] = [
    { value: "all", label: t("sourceAll"), icon: WalletCards },
    { value: "card", label: t("sourceCards"), icon: CreditCard },
    { value: "bank", label: t("sourceBanks"), icon: Landmark },
  ];

  const { from, to } = getMonthRange(selectedDate);

  const allCategoriesQuery = useQuery({
    queryKey: ["categories"],
    queryFn: () => getCategories(),
  });
  const integrationsQuery = useQuery({
    queryKey: ["integrations"],
    queryFn: () => listIntegrations(),
  });

  const expandedCategoryIds = expandCategoryFilterIds(
    categoryFilter,
    allCategoriesQuery.data ?? []
  );

  const transactionsQuery = useQuery({
    queryKey: [
      "transactions",
      from,
      to,
      search,
      categoryFilter,
      accountFilter,
      page,
      kind,
      sourceType,
      reviewFilter,
      sortField,
      sortOrder,
    ],
    queryFn: () =>
      getTransactions({
        from,
        to,
        search: search || undefined,
        categoryIds: expandedCategoryIds,
        credentialIds:
          accountFilter.length > 0 ? accountFilter : undefined,
        limit: 50,
        offset: page * 50,
        kind,
        sourceType,
        needsReview: serializeReviewFilter(reviewFilter) === "true",
        sort: sortField,
        order: sortOrder,
      }),
    placeholderData: keepPreviousData,
  });

  const summaryQuery = useQuery({
    queryKey: ["transactions-summary", from, to, sourceType],
    queryFn: () =>
      getTransactionsSummary({
        from,
        to,
        sourceType,
      }),
  });

  const categoriesQuery = useQuery({
    queryKey: ["categories", kind === "income" ? "income" : "expense"],
    queryFn: () =>
      kind === "income" ? getCategories("income") : getCategories("expense"),
  });

  const monthLabel = formatMonthLabel(selectedDate, locale);
  const pendingReviewActive = isPendingReviewFilter(reviewFilter);

  const summaryInitialLoading =
    summaryQuery.isPending && summaryQuery.data === undefined;
  const tableInitialLoading =
    transactionsQuery.isPending && transactionsQuery.data === undefined;

  return (
    <>
      <PageHeader
        title={t("pageTitle")}
        meta={monthLabel}
        actions={
          <PeriodSelector
            label={monthLabel}
            onPrev={() => setSelectedDate((d) => addMonths(d, -1))}
            onNext={() => setSelectedDate((d) => addMonths(d, 1))}
          />
        }
      />

      <div className="space-y-6 p-4 md:p-6 lg:p-8">
        <AINotConnectedBanner />
        <KpiCards summary={summaryQuery.data} loading={summaryInitialLoading} />

        <WidgetsRow
          summary={summaryQuery.data}
          loading={summaryInitialLoading}
          onReviewNow={() => {
            setReviewFilter("pending");
            setKind("all");
            setSourceType("all");
            setSearch("");
            setCategoryFilter([]);
            setAccountFilter([]);
            setPage(0);
          }}
        />

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1.5 rounded-full border border-border bg-card p-1">
            {filterOptions.map((opt) => {
              const active = kind === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    setKind(opt.value);
                    setReviewFilter("all");
                    setPage(0);
                    setCategoryFilter([]);
                  }}
                  className={
                    active
                      ? "rounded-full bg-foreground px-4 py-1.5 text-xs font-medium text-background transition-colors"
                      : "rounded-full px-4 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  }
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 rounded-full border border-border bg-card p-1">
            {sourceOptions.map((opt) => {
              const active = sourceType === opt.value;
              const Icon = opt.icon;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    setSourceType(opt.value);
                    setReviewFilter("all");
                    setPage(0);
                    setAccountFilter([]);
                  }}
                  className={
                    active
                      ? "inline-flex items-center gap-1.5 rounded-full bg-foreground px-3 py-1.5 text-xs font-medium text-background transition-colors"
                      : "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
                  }
                >
                  <Icon className="size-3.5" aria-hidden="true" />
                  {opt.label}
                </button>
              );
            })}
          </div>

          {pendingReviewActive ? (
            <button
              type="button"
              onClick={() => {
                setReviewFilter("all");
                setPage(0);
              }}
              className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-xs font-medium text-foreground shadow-sm transition-colors hover:bg-accent"
            >
              <HelpCircle
                className="size-3.5"
                style={{ color: "var(--status-heads-up)" }}
                aria-hidden="true"
              />
              {t("pendingReview")}
              <X className="size-3.5 text-muted-foreground" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <TransactionsTable
          transactions={transactionsQuery.data?.transactions ?? []}
          total={transactionsQuery.data?.total ?? 0}
          categories={categoriesQuery.data ?? []}
          integrations={integrationsQuery.data ?? []}
          loading={tableInitialLoading}
          isFetching={transactionsQuery.isFetching}
          sortField={sortField}
          sortOrder={sortOrder}
          onSortChange={(field) => {
            const next = nextSortState(sortField, sortOrder, field);
            setSortField(next.field);
            setSortOrder(next.order);
            setPage(0);
          }}
          search={search}
          onSearchChange={setSearch}
          categoryFilter={categoryFilter}
          onCategoryFilterChange={(ids) => {
            setCategoryFilter(ids);
            setPage(0);
          }}
          accountFilter={accountFilter}
          onAccountFilterChange={(ids) => {
            setAccountFilter(ids);
            setPage(0);
          }}
          page={page}
          onPageChange={setPage}
        />
      </div>
    </>
  );
}
