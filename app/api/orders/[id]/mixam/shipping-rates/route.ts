import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../../lib/supabaseAdmin";
import { getMixamDeliveryRates, getMixamOrder } from "../../../../../../lib/mixam/client";
import { getShopifyShippingPreference } from "../../../../../../lib/mixam/delivery";
import { classifyMixamRate, recommendMixamRate } from "../../../../../../lib/mixam/shipping";
import { safeMixamError } from "../../../../../../lib/mixam/order";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id: orderId } = await context.params;
  let stage = "FULFILLMENT_LOAD";
  try {
    const { data: fulfillment, error: fulfillmentError } = await supabaseAdmin
      .from("supplier_fulfillments").select("*").eq("order_id", orderId).eq("supplier", "mixam").maybeSingle();
    if (fulfillmentError) throw new Error(fulfillmentError.message);
    if (!fulfillment?.supplier_order_id) return NextResponse.json({ ok: false, stage, message: "A Mixam order is required before delivery rates can be retrieved." }, { status: 400 });
    if (fulfillment.test_order !== true) return NextResponse.json({ ok: false, stage, message: "Delivery-rate retrieval is currently restricted to Mixam TEST_ORDER records." }, { status: 403 });
    stage = "ORDER_LOAD";
    const [{ data: order, error: orderError }, mixamOrder] = await Promise.all([
      supabaseAdmin.from("orders").select("*").eq("id", orderId).single(),
      getMixamOrder(fulfillment.supplier_order_id),
    ]);
    if (orderError || !order) throw new Error("Order not found.");
    const destination = mixamOrder.deliveries?.find((delivery) => delivery.id && delivery.deliveryGroups?.some((group) => group.id));
    const group = destination?.deliveryGroups?.find((candidate) => candidate.id);
    if (!destination || !group) return NextResponse.json({ ok: false, stage: "MIXAM_DELIVERY_GROUP", message: "Mixam has not created a delivery destination/group for this TEST_ORDER yet." }, { status: 409 });
    stage = "RATES";
    const rates = await getMixamDeliveryRates(fulfillment.supplier_order_id, destination.id, group.id);
    const preference = getShopifyShippingPreference(order);
    const recommendation = recommendMixamRate(rates, preference.requestedService);
    return NextResponse.json({
      ok: true,
      dryRun: true,
      preference,
      destinationId: destination.id,
      deliveryGroupId: group.id,
      dispatchDate: rates.dispatchDate || null,
      includeShipment: rates.includeShipment ?? null,
      rates: (rates.deliveryRates || []).map((rate) => ({ ...rate, classification: classifyMixamRate(rate) })),
      recommendation,
      selectionApplied: false,
    });
  } catch (error) {
    const message = safeMixamError(error);
    console.error("[mixam] MIXAM_DELIVERY_RATES_FAILED", { orderId, stage, message });
    return NextResponse.json({ ok: false, stage: `MIXAM_${stage}`, message }, { status: 500 });
  }
}
