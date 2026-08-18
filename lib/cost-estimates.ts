export const AI_COST_PER_ESTIMATED_ATTEMPT = 0.1;
export const PAYMENT_FEE_RATE = 0.029;
export const PAYMENT_FIXED_FEE = 0.3;

export type CostEstimateInput = {
  totalPrice?: string | number | null;
  subtotalPrice?: string | number | null;
  orderCurrency?: string | null;
  gelatoQuoteTotal?: string | number | null;
  gelatoCurrency?: string | null;
  estimatedAiAttempts?: number | null;
};

export type CostEstimate = {
  revenue: number | null;
  revenueSource: "total" | "subtotal" | null;
  orderCurrency: string | null;
  gelatoCost: number | null;
  gelatoCurrency: string | null;
  estimatedAiAttempts: number;
  estimatedAiCost: number;
  estimatedPaymentFee: number | null;
  currenciesCompatible: boolean;
  estimatedProfit: number | null;
  estimatedMargin: number | null;
};

export function toValidAmount(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const amount = typeof value === "number" ? value : Number(value);
  return Number.isFinite(amount) && amount >= 0 ? amount : null;
}

export function normalizeCurrency(currency: string | null | undefined) {
  const normalized = currency?.trim().toUpperCase();
  return normalized || null;
}

export function formatAmount(
  amount: number | null,
  currency: string | null | undefined,
  unavailableLabel = "Not available yet"
) {
  if (amount === null || !Number.isFinite(amount)) {
    return unavailableLabel;
  }

  const currencyLabel = normalizeCurrency(currency);
  return `${currencyLabel ? `${currencyLabel} ` : ""}${amount.toFixed(2)}`;
}

export function calculateCostEstimate(input: CostEstimateInput): CostEstimate {
  const totalPrice = toValidAmount(input.totalPrice);
  const subtotalPrice = toValidAmount(input.subtotalPrice);
  const revenue = totalPrice ?? subtotalPrice;
  const revenueSource =
    totalPrice !== null ? "total" : subtotalPrice !== null ? "subtotal" : null;
  const gelatoCost = toValidAmount(input.gelatoQuoteTotal);
  const orderCurrency = normalizeCurrency(input.orderCurrency);
  const gelatoCurrency = normalizeCurrency(input.gelatoCurrency);
  const rawAttempts = Number(input.estimatedAiAttempts || 0);
  const estimatedAiAttempts =
    Number.isFinite(rawAttempts) && rawAttempts > 0 ? rawAttempts : 0;
  const estimatedAiCost =
    estimatedAiAttempts * AI_COST_PER_ESTIMATED_ATTEMPT;
  const estimatedPaymentFee =
    revenue === null ? null : revenue * PAYMENT_FEE_RATE + PAYMENT_FIXED_FEE;
  const currenciesCompatible = Boolean(
    orderCurrency && gelatoCurrency && orderCurrency === gelatoCurrency
  );
  const estimatedProfit =
    revenue !== null &&
    gelatoCost !== null &&
    estimatedPaymentFee !== null &&
    currenciesCompatible
      ? revenue - gelatoCost - estimatedAiCost - estimatedPaymentFee
      : null;
  const estimatedMargin =
    estimatedProfit !== null && revenue !== null && revenue > 0
      ? (estimatedProfit / revenue) * 100
      : null;

  return {
    revenue,
    revenueSource,
    orderCurrency,
    gelatoCost,
    gelatoCurrency,
    estimatedAiAttempts,
    estimatedAiCost,
    estimatedPaymentFee,
    currenciesCompatible,
    estimatedProfit,
    estimatedMargin,
  };
}
