import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../../lib/supabaseAdmin";
import { getFulfilmentRecipient, getShopifyShippingPreference, MixamDeliveryValidationError } from "../../../../../../lib/mixam/delivery";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id: orderId } = await context.params;
  const { data, error } = await supabaseAdmin.from("supplier_fulfillments").select("*, supplier_product_configurations(*)").eq("order_id", orderId).eq("supplier", "mixam").maybeSingle();
  if (error) return NextResponse.json({ ok: false, stage: "MIXAM_STATUS", message: error.message }, { status: 500 });
  const { data: order, error: orderError } = await supabaseAdmin.from("orders").select("*").eq("id", orderId).maybeSingle();
  if (orderError) return NextResponse.json({ ok: false, stage: "MIXAM_STATUS_ORDER", message: orderError.message }, { status: 500 });
  let recipient = null;
  let deliveryValidation: { valid: boolean; message?: string } = { valid: false, message: "Order not found." };
  let customerShipping = null;
  if (order) {
    customerShipping = getShopifyShippingPreference(order);
    try {
      recipient = getFulfilmentRecipient(order);
      deliveryValidation = { valid: true };
    } catch (error) {
      deliveryValidation = { valid: false, message: error instanceof MixamDeliveryValidationError ? error.message : "Unable to validate delivery address." };
    }
  }
  return NextResponse.json({ ok: true, fulfillment: data || null, recipient, customerShipping, deliveryValidation });
}
