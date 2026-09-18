import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../../lib/supabaseAdmin";
import {
  GELATO_CREATE_ORDER_URL,
  callGelatoApi,
  getCurrency,
  getGelatoPageCountForOrder,
  getGelatoProductUidForOrder,
  getProductType,
  getShippingAddress,
} from "../../../../../../lib/gelato";
import {
  claimSupplierSubmission,
  confirmSupplierSubmission,
  ensureSupplierFulfillment,
  markSupplierSubmissionAttempted,
  markSupplierSubmissionUnknown,
  releaseSupplierSubmissionWithoutAttempt,
  resolveStaleSupplierSubmission,
  submissionStateLabel,
} from "../../../../../../lib/supplier-submission";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function safeGelatoError(error: unknown) {
  return (error instanceof Error ? error.message : "Gelato send failed.")
    .replace(/X-API-KEY[^,\s]*/gi, "X-API-KEY [redacted]")
    .slice(0, 1000);
}

export async function POST(
  _: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await context.params;
  let claimed = false;
  let requestAttempted = false;
  let supplierConfirmed = false;
  let stage = "ROUTE_STARTED";

  try {
    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .single();
    if (orderError || !order) {
      return NextResponse.json({ error: "Order not found." }, { status: 404 });
    }

    if (order.gelato_order_id) {
      return NextResponse.json(
        {
          error:
            "Gelato supplier order is already confirmed: " + order.gelato_order_id,
          submissionState: "supplier_confirmed",
        },
        { status: 409 }
      );
    }
    if (!order.pdf_url) {
      throw new Error("PDF must be exported before sending to Gelato.");
    }

    const productType = getProductType(order);
    const productUid =
      order.gelato_product_uid || getGelatoProductUidForOrder(order);
    const pageCount =
      order.gelato_page_count || getGelatoPageCountForOrder(order);
    if (!pageCount) {
      throw new Error("Could not determine Gelato page count for this order.");
    }

    const shippingAddress = getShippingAddress(order);
    const currency = getCurrency(order);
    const shipmentMethodUid = order.gelato_shipment_method_uid || "normal";
    const copies = Number(order.quantity || 1);
    if (!Number.isInteger(copies) || copies < 1) {
      throw new Error("Gelato quantity must be a positive integer.");
    }

    stage = "FULFILLMENT_ENSURE";
    const fulfillment = await ensureSupplierFulfillment(order.id, "gelato", { test_order: false });
    const staleResolution = await resolveStaleSupplierSubmission(fulfillment, "gelato");
    if (staleResolution.state !== "not_sent") {
      return NextResponse.json({
        ok: false,
        stage: staleResolution.state === "submission_unknown"
          ? "GELATO_SUBMISSION_RECONCILIATION_REQUIRED"
          : "GELATO_SUBMISSION_BLOCKED",
        message: submissionStateLabel(staleResolution.state),
        submissionState: staleResolution.state,
      }, { status: 409 });
    }

    stage = "SUBMISSION_CLAIM";
    await claimSupplierSubmission(order.id, "gelato");
    claimed = true;
    await supabaseAdmin
      .from("orders")
      .update({ gelato_status: "submitting", gelato_error: null })
      .eq("id", order.id);

    const payload = {
      orderType: "order",
      orderReferenceId: order.id,
      customerReferenceId: order.customer_email || order.customer_name || order.id,
      currency,
      shipmentMethodUid,
      shippingAddress,
      items: [
        {
          itemReferenceId: order.id + "-book",
          productUid,
          pageCount,
          files: [{ type: "default", url: order.pdf_url }],
          quantity: copies,
        },
      ],
      metadata: [
        { key: "memory_books_order_id", value: order.id },
        { key: "product_type", value: productType },
      ],
    };

    stage = "SUBMISSION_ATTEMPT_MARK";
    await markSupplierSubmissionAttempted(order.id, "gelato");
    requestAttempted = true;

    stage = "GELATO_REQUEST";
    console.info("[gelato] GELATO_ORDER_REQUEST", { orderId: order.id });
    const gelatoOrder = await callGelatoApi(GELATO_CREATE_ORDER_URL, payload);
    const supplierOrderId = String(gelatoOrder?.id || "");
    if (!supplierOrderId) {
      throw new Error(
        "GELATO_RESPONSE: supplier response did not include an order ID; reconciliation is required."
      );
    }

    const trackingUrl =
      gelatoOrder?.shipment?.packages?.[0]?.trackingUrl ||
      gelatoOrder?.shipment?.trackingUrl ||
      null;

    stage = "SUPPLIER_CONFIRM";
    await confirmSupplierSubmission(order.id, "gelato", supplierOrderId, {
      supplier_status: gelatoOrder?.fulfillmentStatus || "submitted",
      tracking_url: trackingUrl,
      submitted_at: new Date().toISOString(),
      raw_supplier_payload: gelatoOrder,
      test_order: false,
    });
    supplierConfirmed = true;

    stage = "ORDER_SAVE";
    const { data: updatedOrder, error: updateError } = await supabaseAdmin
      .from("orders")
      .update({
        gelato_order_id: supplierOrderId,
        gelato_status: gelatoOrder?.fulfillmentStatus || "submitted",
        gelato_product_uid: productUid,
        gelato_page_count: pageCount,
        gelato_shipment_method_uid: shipmentMethodUid,
        gelato_tracking_url: trackingUrl,
        gelato_error: null,
        sent_to_gelato_at: new Date().toISOString(),
        status: "sent_to_gelato",
      })
      .eq("id", order.id)
      .select("*")
      .single();

    if (updateError) throw new Error(updateError.message);

    return NextResponse.json({ ok: true, order: updatedOrder, gelatoOrder });
  } catch (error) {
    const message = safeGelatoError(error);
    const errorCode = requestAttempted
      ? "GELATO_SUBMISSION_OUTCOME_UNKNOWN"
      : "GELATO_SUBMISSION_NOT_ATTEMPTED";

    if (claimed && !supplierConfirmed) {
      try {
        if (requestAttempted) {
          await markSupplierSubmissionUnknown(orderId, "gelato", errorCode, message);
          await supabaseAdmin
            .from("orders")
            .update({ gelato_status: "submission_unknown", gelato_error: message })
            .eq("id", orderId);
        } else {
          await releaseSupplierSubmissionWithoutAttempt(
            orderId,
            "gelato",
            errorCode,
            message
          );
        }
      } catch (stateError) {
        console.error("[gelato] GELATO_SUBMISSION_STATE_SAVE_FAILED", {
          orderId,
          message: safeGelatoError(stateError),
        });
      }
    }

    console.error("[gelato] GELATO_ORDER_FAILED", {
      orderId,
      stage,
      requestAttempted,
      supplierConfirmed,
      message,
    });
    return NextResponse.json(
      {
        ok: false,
        stage: "GELATO_" + stage,
        message,
        submissionState: supplierConfirmed
          ? "supplier_confirmed"
          : requestAttempted
            ? "submission_unknown"
            : "not_sent",
      },
      { status: 500 }
    );
  }
}
