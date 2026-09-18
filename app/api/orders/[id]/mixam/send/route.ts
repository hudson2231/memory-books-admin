import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../../lib/supabaseAdmin";
import { createMixamOrder } from "../../../../../../lib/mixam/client";
import { mixamAddress, safeMixamError } from "../../../../../../lib/mixam/order";
import { getActiveMixamConfiguration, upsertMixamFulfillment } from "../../../../../../lib/mixam/store";
import { getMixamVariantForOrder } from "../../../../../../lib/mixam/configurations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function callbackUrl() {
  const explicit = process.env.MIXAM_STATUS_CALLBACK_URL;
  if (!explicit) throw new Error("MIXAM_TEST_ORDER_REQUEST: MIXAM_STATUS_CALLBACK_URL is required for Mixam status callbacks.");
  return explicit;
}

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id: orderId } = await context.params;
  let stage = "ROUTE_STARTED";
  try {
    if (process.env.MIXAM_TEST_MODE !== "true") throw new Error("MIXAM_TEST_ORDER_REQUEST: test-only sending is locked. Set MIXAM_TEST_MODE=true; paid orders are not supported by this route.");
    const { data: order, error: orderError } = await supabaseAdmin.from("orders").select("*").eq("id", orderId).single();
    if (orderError || !order) return NextResponse.json({ ok: false, stage, message: "Order not found." }, { status: 404 });
    stage = "CONFIG_RESOLVED";
    const variant = getMixamVariantForOrder(order);
    const config = await getActiveMixamConfiguration(variant);
    if (!config.universal_key || !config.offer_id) throw new Error("MIXAM_TEST_ORDER_REQUEST: no validated universal key or offer ID. Refresh Mixam Quote first.");
    stage = "FULFILLMENT_LOAD";
    const { data: fulfillment, error: fulfillmentError } = await supabaseAdmin.from("supplier_fulfillments").select("*").eq("order_id", orderId).eq("supplier", "mixam").maybeSingle();
    if (fulfillmentError || !fulfillment?.cover_pdf_url || !fulfillment?.body_pdf_url) throw new Error("MIXAM_TEST_ORDER_REQUEST: export Mixam cover and body PDFs first.");
    if (fulfillment.supplier_order_id) throw new Error(`MIXAM_TEST_ORDER_REQUEST: a Mixam order already exists: ${fulfillment.supplier_order_id}`);
    stage = "PAYLOAD";
    const address = mixamAddress(order);
    const externalOrderId = `memory-books-${order.id}`;
    const itemSpecification = config.item_specification_json as { product?: unknown } | null;
    if (!itemSpecification || typeof itemSpecification.product !== "string" || !itemSpecification.product) {
      throw new Error("MIXAM_TEST_ORDER_REQUEST: saved item specification has no underlying Mixam product type.");
    }
    const copies = Number(order.quantity || 1);
    if (!Number.isInteger(copies) || copies < 1) {
      throw new Error("MIXAM_TEST_ORDER_REQUEST: order quantity must be a positive integer.");
    }
    const payload = {
      metadata: { externalOrderId, statusCallbackUrl: callbackUrl() },
      orderItems: [{
        // Mixam Orders expects the underlying product enum (for example, BROCHURES), not its catalogue product ID.
        // The validated universal key replaces the full offer-time component specification here.
        product: itemSpecification.product, subProductId: Number(config.sub_product_id), quoteType: config.quote_type,
        universalKey: config.universal_key, offerId: config.offer_id,
        assets: [{ url: fulfillment.cover_pdf_url, name: "cover.pdf" }, { url: fulfillment.body_pdf_url, name: "body.pdf" }],
        metadata: { externalItemId: `${externalOrderId}-book` },
      }],
      billingAddress: address, invoiceAddress: address,
      deliveries: [{ address, itemDeliveryDetails: [{ itemId: `${externalOrderId}-book`, copies }] }],
      plainPackaging: true,
      paymentMethod: "TEST_ORDER",
    };
    stage = "TEST_ORDER_REQUEST";
    console.info("[mixam] MIXAM_TEST_ORDER_REQUEST", { orderId, variant, offerId: config.offer_id });
    const response = await createMixamOrder(payload);
    const supplierOrderId = String(response.id || response.orderId || response.reference || "");
    stage = "FULFILLMENT_SAVE";
    const saved = await upsertMixamFulfillment(orderId, {
      supplier_order_id: supplierOrderId || null,
      supplier_status: String(response.status || response.fulfillmentStatus || "submitted_test_order"),
      artwork_validation_status: String(response.artworkStatus || "pending_validation"),
      quote_total: Number(response.total || response.price || config.price || 0),
      quote_currency: String(response.currency || config.currency || "AUD"),
      test_order: true,
      submitted_at: new Date().toISOString(), error: null, raw_supplier_payload: response,
    });
    console.info("[mixam] MIXAM_TEST_ORDER_CREATED", { orderId, supplierOrderId: supplierOrderId || null });
    return NextResponse.json({ ok: true, testOrder: true, mixamOrder: response, fulfillment: saved });
  } catch (error) {
    const message = safeMixamError(error);
    console.error("[mixam] MIXAM_TEST_ORDER_FAILED", { orderId, stage, message });
    return NextResponse.json({ ok: false, stage: `MIXAM_${stage}`, message }, { status: 500 });
  }
}
