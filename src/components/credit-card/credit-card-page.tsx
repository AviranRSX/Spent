"use client";

import { useMemo, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { CreditCard, HelpCircle, X } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { AINotConnectedBanner } from "@/components/ai-not-connected-banner";
import { PeriodSelector } from "@/components/dashboard/period-selector";
import { TransactionsTable } from "@/components/dashboard/transactions-table";
import { KpiCards } from "@/components/transactions/kpi-cards";
import { WidgetsRow } from "@/components/transactions/widgets-row";
import { PageHeader } from "@/components/layout/app-shell";
import {
  getCategories,
  getSummary,
  getTransactionAccountNumbers,
  getTransactions,
  getTransactionsSummary,
} from "@/lib/api";
import type { TransactionKindFilter } from "@/lib/api";
import {
  addMonths,
  formatCurrency,
  formatMonthLabel,
  getMonthRange,
} from "@/lib/formatters";
import { translateCategoryName } from "@/lib/i18n-data";
import {
  expandCategoryFilterIds,
  formatMultiFilterDisplay,
} from "@/lib/transaction-filters";
import {
  MultiFilterOption,
  TransactionMultiFilter,
} from "@/components/transactions/transaction-multi-filter";
import {
  nextSortState,
  type SortOrder,
  type TransactionSortField,
} from "@/lib/transaction-sort";
import {
  isPendingReviewFilter,
  serializeReviewFilter,
  type TransactionReviewFilter,
} from "@/lib/transaction-review-filter";
import type { CategoryWithData } from "@/lib/types";
import type { Locale } from "@/i18n/routing";

const CREDIT_CARD_SOURCE_TYPE = "card" as const;

export function CreditCardPage() {
  const t = useTranslations("creditCard");
  const tx = useTranslations("transactions");
  const locale = useLocale() as Locale;
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<number[]>([]);
  const [page, setPage] = useState(0);
  const [kind, setKind] = useState<TransactionKindFilter>("expense");
  const [reviewFilter, setReviewFilter] =
    useState<TransactionReviewFilter>("all");
  const [cardNumberFilter, setCardNumberFilter] = useState<string[]>([]);
  const [sortField, setSortField] = useState<TransactionSortField>("date");
  const [sortOrder, setSortOrder] = useState<SortOrder>("desc");

  const filterOptions: { value: TransactionKindFilter; label: string }[] = [
    { value: "all", label: tx("filterAll") },
    { value: "income", label: tx("filterIncome") },
    { value: "expense", label: tx("filterExpenses") },
  ];

  const { from, to } = getMonthRange(selectedDate);
  const monthLabel = formatMonthLabel(selectedDate, locale);

  const allCategoriesQuery = useQuery({
    queryKey: ["categories"],
    queryFn: () => getCategories(),
  });

  const expandedCategoryIds = expandCategoryFilterIds(
    categoryFilter,
    allCategoriesQuery.data ?? []
  );

  const transactionsQuery = useQuery({
    queryKey: [
      "transactions",
      "credit-card",
      from,
      to,
      search,
      categoryFilter,
      page,
      kind,
      reviewFilter,
      cardNumberFilter,
      sortField,
      sortOrder,
    ],
    queryFn: () =>
      getTransactions({
        from,
        to,
        search: search || undefined,
        categoryIds: expandedCategoryIds,
        limit: 50,
        offset: page * 50,
        kind,
        sourceType: CREDIT_CARD_SOURCE_TYPE,
        needsReview: serializeReviewFilter(reviewFilter) === "true",
        accountNumbers:
          cardNumberFilter.length > 0 ? cardNumberFilter : undefined,
        sort: sortField,
        order: sortOrder,
      }),
    placeholderData: keepPreviousData,
  });

  const summaryQuery = useQuery({
    queryKey: ["transactions-summary", from, to, CREDIT_CARD_SOURCE_TYPE],
    queryFn: () =>
      getTransactionsSummary({
        from,
        to,
        sourceType: CREDIT_CARD_SOURCE_TYPE,
      }),
  });

  const categorySummaryQuery = useQuery({
    queryKey: ["summary", from, to, CREDIT_CARD_SOURCE_TYPE],
    queryFn: () =>
      getSummary({
        from,
        to,
        sourceType: CREDIT_CARD_SOURCE_TYPE,
      }),
  });

  const categoriesQuery = useQuery({
    queryKey: ["categories", kind === "income" ? "income" : "expense"],
    queryFn: () =>
      kind === "income" ? getCategories("income") : getCategories("expense"),
  });

  const cardNumbersQuery = useQuery({
    queryKey: ["transaction-account-numbers", from, to, CREDIT_CARD_SOURCE_TYPE],
    queryFn: () =>
      getTransactionAccountNumbers({
        from,
        to,
        sourceType: CREDIT_CARD_SOURCE_TYPE,
      }),
  });

  const pendingReviewActive = isPendingReviewFilter(reviewFilter);
  const summaryInitialLoading =
    summaryQuery.isPending && summaryQuery.data === undefined;
  const tableInitialLoading =
    transactionsQuery.isPending && transactionsQuery.data === undefined;
  const cardNumberOptions = cardNumbersQuery.data ?? [];
  const cardNumberDisplayValue = formatMultiFilterDisplay(
    cardNumberFilter,
    tx("filterAny"),
    (count) => tx("filterSelectedCount", { count })
  );
  const toggleCardNumber = (cardNumber: string) => {
    setCardNumberFilter((current) =>
      current.includes(cardNumber)
        ? current.filter((value) => value !== cardNumber)
        : [...current, cardNumber]
    );
    setPage(0);
  };

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
            setSearch("");
            setCategoryFilter([]);
            setCardNumberFilter([]);
            setPage(0);
          }}
        />

        <CreditCardCategoryOverview
          categories={categorySummaryQuery.data?.categoriesWithData ?? []}
          total={categorySummaryQuery.data?.periodTotal ?? 0}
          loading={
            categorySummaryQuery.isPending &&
            categorySummaryQuery.data === undefined
          }
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

          {cardNumberOptions.length > 0 ? (
            <TransactionMultiFilter
              label={t("filterCard")}
              icon={CreditCard}
              displayValue={cardNumberDisplayValue}
              triggerClassName="w-[180px]"
              selectAllLabel={tx("filterSelectAll")}
              clearLabel={tx("filterClearSelection")}
              onSelectAll={() => {
                setCardNumberFilter(cardNumberOptions);
                setPage(0);
              }}
              onClear={() => {
                setCardNumberFilter([]);
                setPage(0);
              }}
            >
              {cardNumberOptions.map((cardNumber) => (
                <MultiFilterOption
                  key={cardNumber}
                  selected={cardNumberFilter.includes(cardNumber)}
                  onToggle={() => toggleCardNumber(cardNumber)}
                >
                  <span className="tabular-nums">{cardNumber}</span>
                </MultiFilterOption>
              ))}
            </TransactionMultiFilter>
          ) : null}

          {cardNumberFilter.length > 0 ? (
            <button
              type="button"
              onClick={() => {
                setCardNumberFilter([]);
                setPage(0);
              }}
              className="inline-flex h-9 items-center rounded-full px-3 text-xs font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
            >
              {tx("filterClear")}
            </button>
          ) : null}

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
              {tx("pendingReview")}
              <X className="size-3.5 text-muted-foreground" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <TransactionsTable
          transactions={transactionsQuery.data?.transactions ?? []}
          total={transactionsQuery.data?.total ?? 0}
          categories={categoriesQuery.data ?? []}
          integrations={[]}
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
          accountFilter={[]}
          onAccountFilterChange={() => undefined}
          page={page}
          onPageChange={setPage}
          showAccountNumber
        />
      </div>
    </>
  );
}

function CreditCardCategoryOverview({
  categories,
  total,
  loading,
}: {
  categories: CategoryWithData[];
  total: number;
  loading: boolean;
}) {
  const t = useTranslations("creditCard");
  const tCat = useTranslations("categoriesSeeded");
  const locale = useLocale() as Locale;
  const visible = useMemo(
    () =>
      categories
        .filter((category) => category.spent > 0)
        .sort((a, b) => b.spent - a.spent)
        .slice(0, 8),
    [categories]
  );

  return (
    <section className="space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="font-serif text-2xl">{t("categoriesTitle")}</h2>
        <span className="text-sm tabular-nums text-muted-foreground">
          {formatCurrency(total, "ILS", locale)}
        </span>
      </div>
      {loading ? (
        <div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
          {t("loading")}
        </div>
      ) : visible.length === 0 ? (
        <div className="rounded-2xl border border-border bg-card p-5 text-sm text-muted-foreground">
          {t("emptyCategories")}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {visible.map((category) => {
            const pct = total > 0 ? Math.round((category.spent / total) * 100) : 0;
            return (
              <div
                key={category.categoryId}
                className="rounded-2xl border border-border bg-card p-4"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: category.categoryColor }}
                  />
                  <span className="truncate text-sm font-medium">
                    {translateCategoryName(category.categoryName, tCat)}
                  </span>
                </div>
                <div className="mt-3 font-serif text-2xl tabular-nums">
                  {formatCurrency(category.spent, "ILS", locale)}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {t("categoryMeta", {
                    percent: pct,
                    count: category.transactionCount,
                  })}
                </div>
                {category.topMerchant ? (
                  <div className="mt-2 truncate text-xs text-muted-foreground">
                    {t("mostlyMerchant", { merchant: category.topMerchant })}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
