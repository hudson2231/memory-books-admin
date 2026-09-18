import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../../lib/supabaseAdmin";
import { getMixamVariantForOrder } from "../../../../../../lib/mixam/configurations";
import { createMixamPdfs } from "../../../../../../lib/mixam/pdf-export";
import { getActiveMixamConfiguration, upsertMixamFulfillment } from "../../../../../../lib/mixam/store";
import { safeMixamError } from "../../../../../../lib/mixam/order";
import { submissionState } from "../../../../../../lib/supplier-submission";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 300;

function storagePath(orderId: string, name: string) { return `mixam/${orderId}/${name}`; }

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id: orderId } = await context.params;
  const debug = new URL(request.url).searchParams.get("debug") === "1";
  let stage = "ORDER_LOAD";
  try {
    console.info("[mixam] MIXAM_EXPORT_ROUTE_STARTED", { orderId, debug });
    const { data: order, error: orderError } = await supabaseAdmin.from("orders").select("*").eq("id", orderId).single();
    if (orderError || !order) return NextResponse.json({ ok: false, stage, message: "Order not found." }, { status: 404 });
    stage = "IMAGES_LOAD";
    const { data: images, error: imagesError } = await supabaseAdmin.from("order_images").select("*").eq("order_id", orderId).eq("approved", true).order("page_number", { ascending: true });
    if (imagesError) throw new Error(`MIXAM_EXPORT_IMAGES_LOAD: ${imagesError.message}`);
    stage = "FULFILLMENT_LOAD";
    const { data: existingFulfillment, error: fulfillmentError } = await supabaseAdmin
      .from("supplier_fulfillments")
      .select("*")
      .eq("order_id", orderId)
      .eq("supplier", "mixam")
      .maybeSingle();
    if (fulfillmentError) throw new Error(`MIXAM_EXPORT_FULFILLMENT_LOAD: ${fulfillmentError.message}`);
    if (existingFulfillment && (existingFulfillment.supplier_order_id || submissionState(existingFulfillment) !== "not_sent")) {
      return NextResponse.json({
        ok: false,
        stage: "MIXAM_EXPORT_SUBMISSION_STATE",
        message: "Mixam assets cannot be replaced while supplier submission is in progress, unknown, or confirmed.",
        submissionState: submissionState(existingFulfillment),
      }, { status: 409 });
    }
    const variant = getMixamVariantForOrder(order);
    stage = "CONFIG_RESOLVED";
    const configuration = await getActiveMixamConfiguration(variant);
    const spineMm = Number(configuration.spine_mm);
    if (!Number.isFinite(spineMm) || spineMm <= 0) throw new Error("MIXAM_EXPORT_CONFIG_RESOLVED: saved Mixam spine is invalid. Refresh Mixam Quote.");
    stage = "BODY";
    console.info("[mixam] MIXAM_EXPORT_BODY", { orderId, variant, bodyPageCount: configuration.page_count });
    const result = await createMixamPdfs({ order, images: images || [], variant, spineMm, debug });
    stage = "COVER";
    console.info("[mixam] MIXAM_EXPORT_COVER", { orderId, variant, spineMm });
    const timestamp = Date.now();
    const coverPath = storagePath(orderId, `cover-${timestamp}${debug ? "-debug" : ""}.pdf`);
    const bodyPath = storagePath(orderId, `body-${timestamp}${debug ? "-debug" : ""}.pdf`);
    stage = "UPLOAD_COVER";
    const { error: coverError } = await supabaseAdmin.storage.from("pdfs").upload(coverPath, result.coverBytes, { contentType: "application/pdf", upsert: true });
    if (coverError) throw new Error(`MIXAM_EXPORT_UPLOAD_COVER: ${coverError.message}`);
    stage = "UPLOAD_BODY";
    const { error: bodyError } = await supabaseAdmin.storage.from("pdfs").upload(bodyPath, result.bodyBytes, { contentType: "application/pdf", upsert: true });
    if (bodyError) throw new Error(`MIXAM_EXPORT_UPLOAD_BODY: ${bodyError.message}`);
    const { data: coverUrl } = supabaseAdmin.storage.from("pdfs").getPublicUrl(coverPath);
    const { data: bodyUrl } = supabaseAdmin.storage.from("pdfs").getPublicUrl(bodyPath);
    stage = "FULFILLMENT_SAVE";
    const fulfillment = await upsertMixamFulfillment(orderId, {
      configuration_id: configuration.id,
      shopify_line_item_id: order.shopify_line_item_id || null,
      cover_pdf_url: coverUrl.publicUrl,
      body_pdf_url: bodyUrl.publicUrl,
      supplier_status: "assets_exported",
      artwork_validation_status: "not_submitted",
      error: null,
      raw_supplier_payload: { variant, bodyPageCount: result.bodyPageCount, geometry: result.geometry, debug },
    });
    console.info("[mixam] MIXAM_EXPORT_SUCCESS", { orderId, variant, bodyPageCount: result.bodyPageCount });
    return NextResponse.json({ ok: true, variant, bodyPageCount: result.bodyPageCount, geometry: result.geometry, coverPdfUrl: coverUrl.publicUrl, bodyPdfUrl: bodyUrl.publicUrl, fulfillment });
  } catch (error) {
    const message = safeMixamError(error);
    console.error("[mixam] MIXAM_EXPORT_FAILED", { orderId, stage, message });
    return NextResponse.json({ ok: false, stage: `MIXAM_EXPORT_${stage}`, message }, { status: 500 });
  }
}
