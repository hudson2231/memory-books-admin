import { supabaseAdmin } from "../supabaseAdmin";
import { resolveFinalMixamConfiguration, selectStandardAustralianOffer } from "./configurations";
import type { MixamBookVariant } from "./page-layout";

export async function refreshMixamConfiguration(key: MixamBookVariant) {
  const resolved = await resolveFinalMixamConfiguration(key);
  const selected = selectStandardAustralianOffer(resolved.offer);
  const payload = {
    supplier: "mixam",
    configuration_key: key,
    product_id: resolved.configuration.productId,
    sub_product_id: resolved.configuration.subProductId,
    quote_type: resolved.configuration.quoteType,
    item_specification_json: resolved.itemSpecification,
    universal_key: resolved.offer.universalKey || null,
    offer_id: selected.offerId || null,
    page_count: resolved.configuration.bodyPageCount,
    spine_mm: Number(resolved.offer.spine || 0),
    currency: selected.currencyCode || null,
    price: Number(selected.price || 0),
    country_of_origin: selected.countryOfOrigin || null,
    turnaround_days: Number(selected.productionDays || 0),
    print_on_demand_available: Boolean(resolved.offer.printOnDemandAvailable),
    raw_offer_json: resolved.offer,
    validated_at: new Date().toISOString(),
    active: true,
  };
  const { data, error } = await supabaseAdmin
    .from("supplier_product_configurations")
    .upsert(payload, { onConflict: "supplier,configuration_key" })
    .select("*")
    .single();
  if (error) throw new Error(`MIXAM_CONFIG_SAVE: ${error.message}`);
  return { configuration: data, resolved, selected };
}

export async function getActiveMixamConfiguration(key: MixamBookVariant) {
  const { data, error } = await supabaseAdmin
    .from("supplier_product_configurations")
    .select("*")
    .eq("supplier", "mixam")
    .eq("configuration_key", key)
    .eq("active", true)
    .single();
  if (error || !data) throw new Error("MIXAM_CONFIG_RESOLVED: No active validated Mixam configuration. Refresh the quote first.");
  return data;
}

export async function upsertMixamFulfillment(orderId: string, payload: Record<string, unknown>) {
  const { data, error } = await supabaseAdmin
    .from("supplier_fulfillments")
    .upsert({ order_id: orderId, supplier: "mixam", ...payload }, { onConflict: "order_id,supplier" })
    .select("*")
    .single();
  if (error) throw new Error(`MIXAM_FULFILLMENT_SAVE: ${error.message}`);
  return data;
}
