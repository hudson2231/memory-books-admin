import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../../lib/supabaseAdmin";
import { createMixamOrder } from "../../../../../../lib/mixam/client";
import { mixamAddress, safeMixamError } from "../../../../../../lib/mixam/order";
import {
  claimMixamTestSubmission,
  confirmMixamSubmission,
  getActiveMixamConfiguration,
  markMixamSubmissionAttempted,
  markMixamSubmissionUnknown,
  releaseMixamSubmissionWithoutAttempt,
} from "../../../../../../lib/mixam/store";
import { getMixamVariantForOrder } from "../../../../../../lib/mixam/configurations";
import { resolveStaleSupplierSubmission, submissionStateLabel } from "../../../../../../lib/supplier-submission";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

function callbackUrl() {
  const explicit = process.env.MIXAM_STATUS_CALLBACK_URL;
  if (!explicit) {
    throw new Error(
      "MIXAM_TEST_ORDER_REQUEST: MIXAM_STATUS_CALLBACK_URL is required for Mixam status callbacks."
    );
  }
  return explicit;
}

function supplierOrderFromResponse(response: Record<string, unknown>) {
  const nested =
    response.order && typeof response.order === "object"
      ? (response.order as Record<string, unknown>)
      : {};
  return String(
    response.id ||
      response.orderId ||
      response.reference ||
      nested.id ||
      nested.orderId ||
      nested.reference ||
      ""
  );
}

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id: orderId } = await context.params;
  let stage = "ROUTE_STARTED";
  let claimed = false;
  let requestAttempted = false;

  try {
    if (process.env.MIXAM_TEST_MODE !== "true") {
      throw new Error(
        "MIXAM_TEST_ORDER_REQUEST: test-only sending is locked. Set MIXAM_TEST_MODE=true; paid orders are not supported by this route."
      );
    }

    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .select("*")
      .eq("id", orderId)
      .single();
    if (orderError || !order) {
      return NextResponse.json(
        { ok: false, stage, message: "Order not found." },
        { status: 404 }
      );
    }

    stage = "CONFIG_RESOLVED";
    const variant = getMixamVariantForOrder(order);
    const config = await getActiveMixamConfiguration(variant);
    if (!config.universal_key || !config.offer_id) {
      throw new Error(
        "MIXAM_TEST_ORDER_REQUEST: no validated universal key or offer ID. Refresh Mixam Quote first."
      );
    }

    stage = "FULFILLMENT_LOAD";
    const { data: loadedFulfillment, error: fulfillmentError } = await supabaseAdmin
      .from("supplier_fulfillments")
      .select("*")
      .eq("order_id", orderId)
      .eq("supplier", "mixam")
      .maybeSingle();
    let fulfillment = loadedFulfillment;
    if (fulfillment) {
      const staleResolution = await resolveStaleSupplierSubmission(fulfillment, "mixam");
      fulfillment = staleResolution.fulfillment;
      if (staleResolution.state !== "not_sent") {
        return NextResponse.json({
          ok: false,
          stage: staleResolution.state === "submission_unknown"
            ? "MIXAM_SUBMISSION_RECONCILIATION_REQUIRED"
            : "MIXAM_SUBMISSION_BLOCKED",
          message: submissionStateLabel(staleResolution.state),
          submissionState: staleResolution.state,
        }, { status: 409 });
      }
    }
    if (
      fulfillmentError ||
      !fulfillment?.cover_pdf_url ||
      !fulfillment?.body_pdf_url
    ) {
      throw new Error(
        "MIXAM_TEST_ORDER_REQUEST: export Mixam cover and body PDFs first."
      );
    }


    stage = "SUBMISSION_CLAIM";
    await claimMixamTestSubmission(orderId);
    claimed = true;

    stage = "PAYLOAD";
    const address = mixamAddress(order);
    const externalOrderId = "memory-books-" + order.id;
    const itemSpecification = config.item_specification_json as {
      product?: unknown;
    } | null;
    if (
      !itemSpecification ||
      typeof itemSpecification.product !== "string" ||
      !itemSpecification.product
    ) {
      throw new Error(
        "MIXAM_TEST_ORDER_REQUEST: saved item specification has no underlying Mixam product type."
      );
    }

    const copies = Number(order.quantity || 1);
    if (!Number.isInteger(copies) || copies < 1) {
      throw new Error(
        "MIXAM_TEST_ORDER_REQUEST: order quantity must be a positive integer."
      );
    }

    const itemId = externalOrderId + "-book";
    const payload = {
      metadata: { externalOrderId, statusCallbackUrl: callbackUrl() },
      orderItems: [
        {
          product: itemSpecification.product,
          subProductId: Number(config.sub_product_id),
          quoteType: config.quote_type,
          universalKey: config.universal_key,
          offerId: config.offer_id,
          assets: [
            { url: fulfillment.cover_pdf_url, name: "cover.pdf" },
            { url: fulfillment.body_pdf_url, name: "body.pdf" },
          ],
          metadata: { externalItemId: itemId },
        },
      ],
      billingAddress: address,
      invoiceAddress: address,
      deliveries: [
        { address, itemDeliveryDetails: [{ itemId, copies }] },
      ],
      plainPackaging: true,
      paymentMethod: "TEST_ORDER",
    };

    stage = "TEST_ORDER_ATTEMPT_MARK";
    await markMixamSubmissionAttempted(orderId);
    requestAttempted = true;

    stage = "TEST_ORDER_REQUEST";
    console.info("[mixam] MIXAM_TEST_ORDER_REQUEST", {
      orderId,
      variant,
      offerId: config.offer_id,
    });
    const response = await createMixamOrder(payload);
    const supplierOrderId = supplierOrderFromResponse(response);
    if (!supplierOrderId) {
      throw new Error(
        "MIXAM_TEST_ORDER_RESPONSE: supplier accepted a response without an order ID; reconciliation is required."
      );
    }

    stage = "FULFILLMENT_CONFIRM";
    const saved = await confirmMixamSubmission(orderId, supplierOrderId, {
      supplier_status: String(
        response.status ||
          response.fulfillmentStatus ||
          (response.order as Record<string, unknown> | undefined)?.status ||
          "submitted_test_order"
      ),
      artwork_validation_status: String(
        response.artworkStatus ||
          (response.order as Record<string, unknown> | undefined)?.artworkStatus ||
          "pending_validation"
      ),
      quote_total: Number(response.total || response.price || config.price || 0),
      quote_currency: String(response.currency || config.currency || "AUD"),
      test_order: true,
      submitted_at: new Date().toISOString(),
      raw_supplier_payload: response,
    });

    console.info("[mixam] MIXAM_TEST_ORDER_CREATED", { orderId, supplierOrderId });
    return NextResponse.json({
      ok: true,
      testOrder: true,
      mixamOrder: response,
      fulfillment: saved,
    });
  } catch (error) {
    const message = safeMixamError(error);
    const errorCode = requestAttempted
      ? "MIXAM_SUBMISSION_OUTCOME_UNKNOWN"
      : "MIXAM_SUBMISSION_NOT_ATTEMPTED";

    if (claimed) {
      try {
        if (requestAttempted) {
          await markMixamSubmissionUnknown(orderId, errorCode, message);
        } else {
          await releaseMixamSubmissionWithoutAttempt(
            orderId,
            errorCode,
            message
          );
        }
      } catch (stateError) {
        console.error("[mixam] MIXAM_SUBMISSION_STATE_SAVE_FAILED", {
          orderId,
          message: safeMixamError(stateError),
        });
      }
    }

    console.error("[mixam] MIXAM_TEST_ORDER_FAILED", {
      orderId,
      stage,
      requestAttempted,
      message,
    });
    return NextResponse.json(
      {
        ok: false,
        stage: "MIXAM_" + stage,
        message,
        submissionState: requestAttempted
          ? "submission_unknown"
          : "not_sent",
      },
      { status: 500 }
    );
  }
}
