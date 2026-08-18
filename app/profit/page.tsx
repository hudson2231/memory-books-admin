"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  calculateCostEstimate,
  formatAmount,
} from "../../lib/cost-estimates";

type Order = {
  id: string;
  created_at?: string | null;
  customer_name?: string | null;
  shopify_order_id?: string | number | null;
  product_type?: string | null;
  product_title?: string | null;
  variant_title?: string | null;
  page_count?: number | null;
  total_price?: string | number | null;
  subtotal_price?: string | number | null;
  currency?: string | null;
  gelato_quote_total?: string | number | null;
  gelato_quote_currency?: string | null;
  generated_count?: number | null;
  failed_count?: number | null;
};

type OrderFilter = "all" | "likely-real" | "likely-test";
type ReportingPeriod = "all-time" | "this-month" | "this-year" | "custom" | "since-reset";

const PROFIT_RESET_STORAGE_KEY = "memory-books-profit-reset-date";

type CurrencySummary = {
  currency: string;
  orderIds: Set<string>;
  revenue: number;
  revenueOrders: number;
  gelatoCost: number;
  gelatoOrders: number;
  estimatedAiCost: number;
  estimatedPaymentFees: number;
  estimatedProfit: number;
  eligibleRevenue: number;
  eligibleOrders: number;
};

type BreakdownRow = {
  label: string;
  currency: string;
  orders: number;
  eligibleOrders: number;
  revenue: number;
  eligibleRevenue: number;
  estimatedProfit: number;
};

function getProductTypeLabel(order: Order) {
  const value = `${order.product_type || ""} ${order.product_title || ""}`.toLowerCase();
  if (value.includes("story") || value.includes("clip")) {
    return "Story Book";
  }
  if (value.includes("colour") || value.includes("color")) {
    return "Colouring Book";
  }
  return order.product_title?.trim() || "Unknown product";
}

function getProductPageLabel(order: Order) {
  const title = order.product_title?.trim() || getProductTypeLabel(order);
  const variant = order.variant_title?.trim();
  const pages = Number(order.page_count);
  const pageLabel = Number.isFinite(pages) && pages > 0 ? `${pages} pages` : null;
  return [title, variant, pageLabel].filter(Boolean).join(" · ");
}

function isLikelyTestOrder(order: Order) {
  const productTitle = order.product_title?.trim().toLowerCase() || "";
  const customerName = order.customer_name?.trim().toLowerCase() || "";
  const pageCount = Number(order.page_count);
  const estimate = calculateCostEstimate({
    totalPrice: order.total_price,
    subtotalPrice: order.subtotal_price,
    orderCurrency: order.currency,
  });
  const hasTestText = productTitle.includes("test") || customerName.includes("test");
  const missingShopifyOrder =
    order.shopify_order_id === null ||
    order.shopify_order_id === undefined ||
    String(order.shopify_order_id).trim() === "";
  const hasSmallLowValueAudOrder =
    Number.isFinite(pageCount) &&
    pageCount < 20 &&
    estimate.orderCurrency === "AUD" &&
    estimate.revenue !== null &&
    estimate.revenue < 40;

  return hasTestText || missingShopifyOrder || hasSmallLowValueAudOrder;
}

function getCreatedAtTimestamp(order: Order) {
  if (!order.created_at) return null;
  const timestamp = new Date(order.created_at).getTime();
  return Number.isFinite(timestamp) ? timestamp : null;
}

function addBreakdownOrder(
  map: Map<string, BreakdownRow>,
  label: string,
  estimate: ReturnType<typeof calculateCostEstimate>
) {
  const currency = estimate.orderCurrency || "Currency unavailable";
  const key = `${label}\u0000${currency}`;
  const row = map.get(key) || {
    label,
    currency,
    orders: 0,
    eligibleOrders: 0,
    revenue: 0,
    eligibleRevenue: 0,
    estimatedProfit: 0,
  };

  row.orders += 1;
  if (estimate.revenue !== null) {
    row.revenue += estimate.revenue;
  }
  if (estimate.estimatedProfit !== null && estimate.revenue !== null) {
    row.eligibleOrders += 1;
    row.eligibleRevenue += estimate.revenue;
    row.estimatedProfit += estimate.estimatedProfit;
  }
  map.set(key, row);
}

function marginFor(row: BreakdownRow) {
  return row.eligibleRevenue > 0
    ? (row.estimatedProfit / row.eligibleRevenue) * 100
    : null;
}

export default function ProfitDashboardPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [orderFilter, setOrderFilter] = useState<OrderFilter>("all");
  const [reportingPeriod, setReportingPeriod] = useState<ReportingPeriod>("all-time");
  const [customStartDate, setCustomStartDate] = useState("");
  const [customEndDate, setCustomEndDate] = useState("");
  const [resetDate, setResetDate] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const storedResetDate = window.localStorage.getItem(PROFIT_RESET_STORAGE_KEY);
    if (storedResetDate && Number.isFinite(new Date(storedResetDate).getTime())) {
      setResetDate(storedResetDate);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadOrders() {
      try {
        const response = await fetch("/api/orders", { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error || "Failed to load orders.");
        }
        if (!cancelled) {
          setOrders(data.orders || []);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Failed to load orders.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadOrders();
    return () => {
      cancelled = true;
    };
  }, []);

  function resetProfitPeriod() {
    const now = new Date().toISOString();
    window.localStorage.setItem(PROFIT_RESET_STORAGE_KEY, now);
    setResetDate(now);
    setReportingPeriod("since-reset");
  }

  function clearResetDate() {
    window.localStorage.removeItem(PROFIT_RESET_STORAGE_KEY);
    setResetDate(null);
    if (reportingPeriod === "since-reset") {
      setReportingPeriod("all-time");
    }
  }

  const periodResult = useMemo(() => {
    const now = new Date();
    let startTimestamp: number | null = null;
    let endTimestamp: number | null = null;
    let activeLabel = "All time";
    let message = "";
    let isDateDependent = reportingPeriod !== "all-time";

    if (reportingPeriod === "this-month") {
      startTimestamp = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      activeLabel = "This month";
    } else if (reportingPeriod === "this-year") {
      startTimestamp = new Date(now.getFullYear(), 0, 1).getTime();
      activeLabel = "This year";
    } else if (reportingPeriod === "custom") {
      const customStart = customStartDate
        ? new Date(`${customStartDate}T00:00:00`).getTime()
        : Number.NaN;
      const customEnd = customEndDate
        ? new Date(`${customEndDate}T23:59:59.999`).getTime()
        : Number.NaN;
      if (
        Number.isFinite(customStart) &&
        Number.isFinite(customEnd) &&
        customStart <= customEnd
      ) {
        startTimestamp = customStart;
        endTimestamp = customEnd;
        activeLabel = `Custom: ${customStartDate} to ${customEndDate}`;
      } else {
        isDateDependent = false;
        activeLabel = "All time (custom range incomplete)";
        message = "Choose a valid custom start and end date. Showing all orders safely until the range is complete.";
      }
    } else if (reportingPeriod === "since-reset") {
      const storedTimestamp = resetDate ? new Date(resetDate).getTime() : Number.NaN;
      if (Number.isFinite(storedTimestamp)) {
        startTimestamp = storedTimestamp;
        activeLabel = `Since reset: ${new Date(storedTimestamp).toLocaleString()}`;
      } else {
        isDateDependent = false;
        activeLabel = "All time (no reset date set)";
        message = "No local reset date exists yet. Showing all orders safely. Use “Reset profit period” to start a new reporting period.";
      }
    }

    let invalidCreatedAtCount = 0;
    const periodOrders = orders.filter((order) => {
      if (!isDateDependent) return true;
      const timestamp = getCreatedAtTimestamp(order);
      if (timestamp === null) {
        invalidCreatedAtCount += 1;
        return false;
      }
      if (startTimestamp !== null && timestamp < startTimestamp) return false;
      if (endTimestamp !== null && timestamp > endTimestamp) return false;
      return true;
    });

    return {
      orders: periodOrders,
      activeLabel,
      message,
      invalidCreatedAtCount,
      isDateDependent,
    };
  }, [orders, reportingPeriod, customStartDate, customEndDate, resetDate]);

  const orderClassification = useMemo(() => {
    const likelyTestIds = new Set(
      periodResult.orders.filter(isLikelyTestOrder).map((order) => order.id)
    );
    return {
      likelyTestIds,
      likelyTestCount: likelyTestIds.size,
      likelyRealCount: periodResult.orders.length - likelyTestIds.size,
    };
  }, [periodResult.orders]);

  const filteredOrders = useMemo(() => {
    if (orderFilter === "likely-test") {
      return periodResult.orders.filter((order) => orderClassification.likelyTestIds.has(order.id));
    }
    if (orderFilter === "likely-real") {
      return periodResult.orders.filter((order) => !orderClassification.likelyTestIds.has(order.id));
    }
    return periodResult.orders;
  }, [periodResult.orders, orderFilter, orderClassification]);

  const dashboard = useMemo(() => {
    const currencyMap = new Map<string, CurrencySummary>();
    const productMap = new Map<string, BreakdownRow>();
    const productPageMap = new Map<string, BreakdownRow>();
    let missingRevenue = 0;
    let missingGelatoQuote = 0;
    let currencyMismatch = 0;

    function getCurrencySummary(currency: string) {
      const current = currencyMap.get(currency);
      if (current) return current;
      const created: CurrencySummary = {
        currency,
        orderIds: new Set<string>(),
        revenue: 0,
        revenueOrders: 0,
        gelatoCost: 0,
        gelatoOrders: 0,
        estimatedAiCost: 0,
        estimatedPaymentFees: 0,
        estimatedProfit: 0,
        eligibleRevenue: 0,
        eligibleOrders: 0,
      };
      currencyMap.set(currency, created);
      return created;
    }

    for (const order of filteredOrders) {
      const estimate = calculateCostEstimate({
        totalPrice: order.total_price,
        subtotalPrice: order.subtotal_price,
        orderCurrency: order.currency,
        gelatoQuoteTotal: order.gelato_quote_total,
        gelatoCurrency: order.gelato_quote_currency,
        estimatedAiAttempts: order.generated_count,
      });

      if (estimate.revenue === null) missingRevenue += 1;
      if (estimate.gelatoCost === null) missingGelatoQuote += 1;
      if (
        estimate.revenue !== null &&
        estimate.gelatoCost !== null &&
        !estimate.currenciesCompatible
      ) {
        currencyMismatch += 1;
      }

      if (estimate.orderCurrency) {
        const summary = getCurrencySummary(estimate.orderCurrency);
        summary.orderIds.add(order.id);
        if (estimate.revenue !== null) {
          summary.revenue += estimate.revenue;
          summary.revenueOrders += 1;
        }
        if (
          estimate.estimatedProfit !== null &&
          estimate.revenue !== null &&
          estimate.gelatoCost !== null &&
          estimate.estimatedPaymentFee !== null
        ) {
          summary.gelatoCost += estimate.gelatoCost;
          summary.gelatoOrders += 1;
          summary.estimatedAiCost += estimate.estimatedAiCost;
          summary.estimatedPaymentFees += estimate.estimatedPaymentFee;
          summary.estimatedProfit += estimate.estimatedProfit;
          summary.eligibleRevenue += estimate.revenue;
          summary.eligibleOrders += 1;
        }
      }

      addBreakdownOrder(productMap, getProductTypeLabel(order), estimate);
      addBreakdownOrder(productPageMap, getProductPageLabel(order), estimate);
    }

    const currencies = Array.from(currencyMap.values()).sort((a, b) =>
      a.currency.localeCompare(b.currency)
    );
    const productRows = Array.from(productMap.values()).sort(
      (a, b) => b.estimatedProfit - a.estimatedProfit
    );
    const productPageRows = Array.from(productPageMap.values()).sort(
      (a, b) => b.estimatedProfit - a.estimatedProfit
    );
    const marginRows = productPageRows.filter((row) => marginFor(row) !== null);
    const bestMargin = [...marginRows].sort(
      (a, b) => (marginFor(b) || 0) - (marginFor(a) || 0)
    )[0] || null;
    const worstMargin = [...marginRows].sort(
      (a, b) => (marginFor(a) || 0) - (marginFor(b) || 0)
    )[0] || null;

    return {
      currencies,
      productRows,
      productPageRows,
      missingRevenue,
      missingGelatoQuote,
      currencyMismatch,
      bestMargin,
      worstMargin,
    };
  }, [filteredOrders]);

  return (
    <main className="min-h-screen bg-neutral-950 text-white">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="mb-10">
          <p className="text-sm uppercase tracking-[0.3em] text-neutral-400">Memory Books</p>
          <div className="mt-3 flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
            <div>
              <h1 className="text-4xl font-semibold">Profit Dashboard</h1>
              <p className="mt-3 max-w-3xl text-neutral-400">
                Read-only all-time estimates for the orders currently returned by the admin API.
              </p>
            </div>
            <nav className="flex gap-2 text-sm">
              <Link href="/" className="rounded-xl border border-neutral-700 px-4 py-2 text-neutral-300 hover:border-white hover:text-white">
                Orders
              </Link>
              <Link href="/profit" className="rounded-xl border border-white bg-white px-4 py-2 text-black">
                Profit Dashboard
              </Link>
            </nav>
          </div>
        </div>

        {loading ? (
          <p className="text-neutral-400">Loading profit estimates...</p>
        ) : error ? (
          <p className="rounded-xl border border-red-900 bg-red-950/30 p-4 text-red-300">{error}</p>
        ) : (
          <>
            <section className="mb-8 rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
              <div className="flex flex-col gap-5">
                <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div>
                    <p className="text-sm uppercase tracking-[0.25em] text-neutral-500">Reporting period</p>
                    <h2 className="mt-2 text-xl font-medium">{periodResult.activeLabel}</h2>
                    <p className="mt-2 text-sm text-neutral-400">
                      Profit reset is local to this browser/device and never changes or deletes actual orders.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={resetProfitPeriod}
                      className="rounded-xl border border-amber-800 px-4 py-2 text-sm text-amber-200 hover:border-amber-400"
                    >
                      Reset profit period
                    </button>
                    <button
                      type="button"
                      onClick={clearResetDate}
                      disabled={!resetDate}
                      className="rounded-xl border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:border-white hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Clear reset date
                    </button>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2">
                  {([
                    ["all-time", "All time"],
                    ["this-month", "This month"],
                    ["this-year", "This year"],
                    ["custom", "Custom date range"],
                    ["since-reset", "Since reset date"],
                  ] as Array<[ReportingPeriod, string]>).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setReportingPeriod(value)}
                      className={`rounded-xl border px-4 py-2 text-sm transition ${
                        reportingPeriod === value
                          ? "border-white bg-white text-black"
                          : "border-neutral-700 bg-neutral-950 text-neutral-300 hover:border-white hover:text-white"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {reportingPeriod === "custom" && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <label className="text-sm text-neutral-300">
                      Start date
                      <input
                        type="date"
                        value={customStartDate}
                        onChange={(event) => setCustomStartDate(event.target.value)}
                        className="mt-2 block w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-white outline-none focus:border-white"
                      />
                    </label>
                    <label className="text-sm text-neutral-300">
                      End date
                      <input
                        type="date"
                        value={customEndDate}
                        onChange={(event) => setCustomEndDate(event.target.value)}
                        className="mt-2 block w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-white outline-none focus:border-white"
                      />
                    </label>
                  </div>
                )}

                {resetDate && (
                  <p className="text-sm text-neutral-500">
                    Local reset date: {new Date(resetDate).toLocaleString()}
                  </p>
                )}
                {periodResult.message && (
                  <p className="rounded-xl border border-amber-900 bg-amber-950/30 p-4 text-sm text-amber-200">
                    {periodResult.message}
                  </p>
                )}
                {periodResult.isDateDependent && periodResult.invalidCreatedAtCount > 0 && (
                  <p className="text-sm text-amber-300">
                    {periodResult.invalidCreatedAtCount} order(s) with missing or invalid creation dates were excluded from this period.
                  </p>
                )}
              </div>
            </section>

            <section className="mb-8 rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
              <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                  <h2 className="text-lg font-medium">Order view</h2>
                  <p className="mt-1 text-sm text-neutral-400">
                    Likely test order detection is approximate and does not change any order data.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {([
                    ["all", `All orders (${periodResult.orders.length})`],
                    ["likely-real", `Likely real orders (${orderClassification.likelyRealCount})`],
                    ["likely-test", `Likely test orders (${orderClassification.likelyTestCount})`],
                  ] as Array<[OrderFilter, string]>).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setOrderFilter(value)}
                      className={`rounded-xl border px-4 py-2 text-sm transition ${
                        orderFilter === value
                          ? "border-white bg-white text-black"
                          : "border-neutral-700 text-neutral-300 hover:border-white hover:text-white"
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </section>

            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard label="Orders in selected view" value={String(filteredOrders.length)} />
              <MetricCard label="Orders missing revenue" value={String(dashboard.missingRevenue)} />
              <MetricCard label="Orders missing Gelato quote" value={String(dashboard.missingGelatoQuote)} />
              <MetricCard label="Currency mismatches" value={String(dashboard.currencyMismatch)} />
            </section>

            <section className="mt-6 rounded-2xl border border-blue-950 bg-blue-950/20 p-5 text-sm text-blue-200">
              Profit estimates only include orders with valid revenue and Gelato quote data. Orders missing Gelato quotes are excluded from profit calculations.
            </section>

            {dashboard.currencies.length === 0 ? (
              <section className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900 p-6 text-neutral-400">
                Not available yet. No currency-tagged financial data was found.
              </section>
            ) : (
              <div className="mt-8 space-y-6">
                {dashboard.currencies.map((summary) => {
                  const averageOrderValue = summary.revenueOrders > 0
                    ? summary.revenue / summary.revenueOrders
                    : null;
                  const averageMargin = summary.eligibleRevenue > 0
                    ? (summary.estimatedProfit / summary.eligibleRevenue) * 100
                    : null;
                  return (
                    <section key={summary.currency} className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
                      <div className="flex items-center justify-between gap-4">
                        <div>
                          <p className="text-sm uppercase tracking-[0.25em] text-neutral-500">Currency</p>
                          <h2 className="mt-2 text-2xl font-medium">{summary.currency}</h2>
                        </div>
                        <p className="text-sm text-neutral-500">{summary.orderIds.size} order(s)</p>
                      </div>
                      <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                        <MetricCard label="Tracked revenue (orders with revenue data)" value={formatAmount(summary.revenueOrders ? summary.revenue : null, summary.currency)} />
                        <MetricCard label="Profit-eligible revenue" value={formatAmount(summary.eligibleOrders ? summary.eligibleRevenue : null, summary.currency)} />
                        <MetricCard label="Eligible-order Gelato costs" value={formatAmount(summary.eligibleOrders ? summary.gelatoCost : null, summary.currency)} />
                        <MetricCard label="Eligible-order estimated AI costs" value={formatAmount(summary.eligibleOrders ? summary.estimatedAiCost : null, summary.currency)} />
                        <MetricCard label="Eligible-order estimated payment fees" value={formatAmount(summary.eligibleOrders ? summary.estimatedPaymentFees : null, summary.currency)} />
                        <MetricCard label="Profit-eligible estimated profit" value={formatAmount(summary.eligibleOrders ? summary.estimatedProfit : null, summary.currency)} highlight />
                        <MetricCard label="Profit-eligible estimated margin" value={averageMargin === null ? "Not available yet" : `${averageMargin.toFixed(1)}%`} />
                        <MetricCard label="Tracked average order value" value={formatAmount(averageOrderValue, summary.currency)} />
                        <MetricCard label="Profit-eligible orders" value={`${summary.eligibleOrders}/${summary.orderIds.size}`} />
                      </div>
                    </section>
                  );
                })}
              </div>
            )}

            <section className="mt-8 grid gap-4 md:grid-cols-2">
              <MarginCard label="Best estimated margin product" row={dashboard.bestMargin} />
              <MarginCard label="Worst estimated margin product" row={dashboard.worstMargin} />
            </section>

            <BreakdownTable title="Estimated profit by product type" rows={dashboard.productRows} />
            <BreakdownTable title="Estimated profit by product and page count" rows={dashboard.productPageRows} />

            <section className="mt-8 rounded-2xl border border-amber-950 bg-amber-950/20 p-6 text-sm text-amber-200">
              <h2 className="font-medium">Estimate assumptions</h2>
              <p className="mt-2 leading-6 text-amber-200/80">
                AI cost uses a temporary 0.10 per generated page/attempt estimate. Payment fees use a temporary 2.9% + 0.30 estimate. Aggregate AI estimates use generated pages only and exclude detailed regeneration history. Estimates also exclude refunds, reprints, chargebacks, taxes, and currency conversion. The orders API currently returns at most 500 orders.
              </p>
            </section>
          </>
        )}
      </div>
    </main>
  );
}

function MetricCard({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-4 ${highlight ? "border-green-950 bg-green-950/20" : "border-neutral-800 bg-neutral-950"}`}>
      <p className={highlight ? "text-sm text-green-400" : "text-sm text-neutral-500"}>{label}</p>
      <p className={`mt-2 text-xl font-semibold ${highlight ? "text-green-300" : "text-white"}`}>{value}</p>
    </div>
  );
}

function MarginCard({ label, row }: { label: string; row: BreakdownRow | null }) {
  const margin = row ? marginFor(row) : null;
  return (
    <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
      <p className="text-sm text-neutral-500">{label}</p>
      <p className="mt-2 text-xl font-medium">{row?.label || "Not available yet"}</p>
      <p className="mt-2 text-neutral-400">
        {margin === null ? "Not available yet" : `${margin.toFixed(1)}% · ${row?.currency}`}
      </p>
    </div>
  );
}

function BreakdownTable({ title, rows }: { title: string; rows: BreakdownRow[] }) {
  return (
    <section className="mt-8 overflow-hidden rounded-2xl border border-neutral-800 bg-neutral-900">
      <div className="border-b border-neutral-800 p-6">
        <h2 className="text-2xl font-medium">{title}</h2>
      </div>
      {rows.length === 0 ? (
        <p className="p-6 text-neutral-500">Not available yet</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="bg-neutral-950 text-neutral-500">
              <tr>
                <th className="px-6 py-3 font-medium">Product</th>
                <th className="px-4 py-3 font-medium">Currency</th>
                <th className="px-4 py-3 font-medium">Orders</th>
                <th className="px-4 py-3 font-medium">Tracked revenue</th>
                <th className="px-4 py-3 font-medium">Profit-eligible revenue</th>
                <th className="px-4 py-3 font-medium">Estimated profit</th>
                <th className="px-4 py-3 font-medium">Estimated margin</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-800">
              {rows.map((row) => {
                const margin = marginFor(row);
                return (
                  <tr key={`${row.label}-${row.currency}`}>
                    <td className="px-6 py-4 text-neutral-200">{row.label}</td>
                    <td className="px-4 py-4 text-neutral-400">{row.currency}</td>
                    <td className="px-4 py-4 text-neutral-400">{row.orders}</td>
                    <td className="px-4 py-4 text-neutral-300">{formatAmount(row.revenue || null, row.currency)}</td>
                    <td className="px-4 py-4 text-neutral-300">{formatAmount(row.eligibleOrders ? row.eligibleRevenue : null, row.currency)}</td>
                    <td className="px-4 py-4 text-green-300">{formatAmount(row.eligibleOrders ? row.estimatedProfit : null, row.currency)}</td>
                    <td className="px-4 py-4 text-neutral-300">{margin === null ? "Not available yet" : `${margin.toFixed(1)}%`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
