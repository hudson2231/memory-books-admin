import type { MixamDeliveryRate, MixamDeliveryRatesResponse } from "./types";

export type MixamRateClass = "standard" | "express" | "premium" | "unknown";
export type RateRecommendation = { rate: MixamDeliveryRate | null; classification: MixamRateClass; reason: string; requiresOperatorReview: boolean };

function rateText(rate: MixamDeliveryRate) {
  return [rate.service, rate.serviceCode, rate.courier, rate.courierCode].filter(Boolean).join(" ").toLowerCase();
}

export function classifyMixamRate(rate: MixamDeliveryRate): MixamRateClass {
  const text = rateText(rate);
  if (/same.?day|urgent|super.?express|premium priority/.test(text)) return "premium";
  if (/express|expedited|priority|overnight|next.?day/.test(text)) return "express";
  if (/standard|economy|regular|ground|parcel|road/.test(text)) return "standard";
  return "unknown";
}

function usable(rate: MixamDeliveryRate) { return Boolean(rate.serviceId) && Number.isFinite(rate.cost) && rate.cost >= 0; }
function byCostThenTransit(a: MixamDeliveryRate, b: MixamDeliveryRate) {
  return a.cost !== b.cost ? a.cost - b.cost : Number(a.daysInTransit ?? Number.MAX_SAFE_INTEGER) - Number(b.daysInTransit ?? Number.MAX_SAFE_INTEGER);
}

/** Recommendation only. This function never calls Mixam's rate-selection PATCH. */
export function recommendMixamRate(response: MixamDeliveryRatesResponse, preference: "standard" | "express" | "unknown", configuredMultiplier = Number(process.env.MIXAM_RATE_MAX_PREMIUM_MULTIPLIER || 3)): RateRecommendation {
  const rates = (response.deliveryRates || []).filter(usable);
  if (!rates.length) return { rate: null, classification: "unknown", requiresOperatorReview: true, reason: "Mixam returned no selectable delivery rates." };
  const standard = rates.filter((rate) => classifyMixamRate(rate) === "standard").sort(byCostThenTransit);
  const express = rates.filter((rate) => classifyMixamRate(rate) === "express").sort(byCostThenTransit);
  const nonPremium = rates.filter((rate) => classifyMixamRate(rate) !== "premium").sort(byCostThenTransit);
  const candidates = preference === "express" ? express : standard.length ? standard : nonPremium.filter((rate) => classifyMixamRate(rate) !== "express");
  const rate = candidates[0] || null;
  if (!rate) return { rate: null, classification: "unknown", requiresOperatorReview: true, reason: `No clearly ${preference === "express" ? "express" : "standard"} Mixam rate was returned.` };
  const cheapest = [...rates].sort(byCostThenTransit)[0];
  const multiplier = Number.isFinite(configuredMultiplier) && configuredMultiplier > 1 ? configuredMultiplier : 3;
  const requiresOperatorReview = rate.cost > cheapest.cost * multiplier && rate.cost > 0;
  return {
    rate,
    classification: classifyMixamRate(rate),
    requiresOperatorReview,
    reason: requiresOperatorReview ? `Recommended rate exceeds the configured ${multiplier}× premium guardrail over the cheapest available rate.` : preference === "express" ? "Lowest-cost clearly express Mixam rate." : "Lowest-cost clearly standard/non-premium Mixam rate.",
  };
}

export type MixamShipment = { trackingUrl: string | null; trackingNumber: string | null; courier: string | null; dispatchedAt: string | null; parcelNumbers: string[] };

export function getLatestMixamShipment(payload: Record<string, unknown>): MixamShipment | null {
  const shipments = Array.isArray(payload.shipments) ? payload.shipments : [];
  const records = shipments.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object");
  const shipment = records[records.length - 1] || (payload.shipment && typeof payload.shipment === "object" ? payload.shipment as Record<string, unknown> : null);
  if (!shipment) return null;
  const value = (...keys: string[]) => {
    for (const key of keys) { const found = shipment[key]; if (typeof found === "string" || typeof found === "number") return String(found); }
    return null;
  };
  return {
    trackingUrl: value("trackingUrl", "tracking_url"),
    trackingNumber: value("consignmentNumber", "trackingNumber", "tracking_number"),
    courier: value("courier", "carrier"),
    dispatchedAt: value("date", "dispatchDate"),
    parcelNumbers: Array.isArray(shipment.parcelNumbers) ? shipment.parcelNumbers.filter((item): item is string => typeof item === "string") : [],
  };
}
