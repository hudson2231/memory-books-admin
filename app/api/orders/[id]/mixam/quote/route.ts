import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../../lib/supabaseAdmin";
import { getMixamVariantForOrder } from "../../../../../../lib/mixam/configurations";
import { refreshMixamConfiguration } from "../../../../../../lib/mixam/store";
import { safeMixamError } from "../../../../../../lib/mixam/order";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id: orderId } = await context.params;
  let stage = "ORDER_LOAD";
  try {
    const { data: order, error } = await supabaseAdmin.from("orders").select("*").eq("id", orderId).single();
    if (error || !order) return NextResponse.json({ ok: false, stage, message: "Order not found." }, { status: 404 });
    stage = "CONFIG_RESOLVED";
    const variant = getMixamVariantForOrder(order);
    console.info("[mixam] MIXAM_OFFER_REQUEST", { orderId, variant });
    const result = await refreshMixamConfiguration(variant);
    stage = "OFFER_SELECTED";
    console.info("[mixam] MIXAM_OFFER_SELECTED", { orderId, variant, offerId: result.selected.offerId, price: result.selected.price, currency: result.selected.currencyCode });
    return NextResponse.json({
      ok: true, variant, configuration: result.configuration,
      quote: {
        printPrice: result.selected.price, currency: result.selected.currencyCode,
        productionDays: result.selected.productionDays, origin: result.selected.countryOfOrigin,
        spineMm: result.resolved.offer.spine, universalKey: result.resolved.offer.universalKey,
        offerId: result.selected.offerId, printOnDemandAvailable: result.resolved.offer.printOnDemandAvailable,
        vat: result.resolved.offer.vat, shipmentIncluded: result.selected.includeShipment,
      },
    });
  } catch (error) {
    const message = safeMixamError(error);
    console.error("[mixam] MIXAM_QUOTE_FAILED", { orderId, stage, message });
    return NextResponse.json({ ok: false, stage: `MIXAM_${stage}`, message }, { status: 500 });
  }
}
