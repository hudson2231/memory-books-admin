import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function value(record: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const found = record[key];
    if (typeof found === "string" || typeof found === "number") return String(found);
  }
  return "";
}

export async function POST(request: Request) {
  let payload: Record<string, unknown>;
  try {
    payload = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, stage: "MIXAM_WEBHOOK_PARSE", message: "Invalid JSON payload." }, { status: 400 });
  }
  const metadata = (payload.metadata && typeof payload.metadata === "object" ? payload.metadata : {}) as Record<string, unknown>;
  const externalOrderId = value(metadata, "externalOrderId") || value(payload, "externalOrderId", "reference", "customerReference");
  const supplierOrderId = value(payload, "id", "orderId", "supplierOrderId");
  const memoryOrderId = externalOrderId.replace(/^memory-books-/, "");
  if (!memoryOrderId && !supplierOrderId) return NextResponse.json({ ok: false, stage: "MIXAM_WEBHOOK_IDENTIFY", message: "No order identifier in callback." }, { status: 400 });
  let query = supabaseAdmin.from("supplier_fulfillments").select("*").eq("supplier", "mixam");
  query = memoryOrderId ? query.eq("order_id", memoryOrderId) : query.eq("supplier_order_id", supplierOrderId);
  const { data: fulfillment, error } = await query.maybeSingle();
  if (error) return NextResponse.json({ ok: false, stage: "MIXAM_WEBHOOK_LOOKUP", message: error.message }, { status: 500 });
  if (!fulfillment) return NextResponse.json({ ok: true, ignored: true });
  const shipment = (payload.shipment && typeof payload.shipment === "object" ? payload.shipment : {}) as Record<string, unknown>;
  const trackingUrl = value(shipment, "trackingUrl", "tracking_url") || value(payload, "trackingUrl", "tracking_url") || null;
  const status = value(payload, "status", "fulfillmentStatus", "state") || fulfillment.supplier_status;
  const artworkStatus = value(payload, "artworkStatus", "artworkValidationStatus", "validationStatus") || fulfillment.artwork_validation_status;
  const rejection = value(payload, "error", "rejectionReason", "message") || null;
  const { error: updateError } = await supabaseAdmin.from("supplier_fulfillments").update({
    supplier_order_id: supplierOrderId || fulfillment.supplier_order_id,
    supplier_status: status,
    artwork_validation_status: artworkStatus,
    tracking_url: trackingUrl,
    error: rejection,
    raw_supplier_payload: payload,
    last_supplier_event_at: new Date().toISOString(),
  }).eq("id", fulfillment.id);
  if (updateError) return NextResponse.json({ ok: false, stage: "MIXAM_WEBHOOK_SAVE", message: updateError.message }, { status: 500 });
  console.info("[mixam] MIXAM_WEBHOOK_RECEIVED", { orderId: fulfillment.order_id, supplierOrderId: supplierOrderId || null, status, artworkStatus });
  return NextResponse.json({ ok: true });
}
