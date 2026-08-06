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

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await context.params;

  const { data: order, error: orderError } = await supabaseAdmin
    .from("orders")
    .select("*")
    .eq("id", orderId)
    .single();

  if (orderError || !order) {
    return NextResponse.json({ error: "Order not found." }, { status: 404 });
  }

  try {
    if (order.gelato_order_id) {
      throw new Error(`Order has already been sent to Gelato: ${order.gelato_order_id}`);
    }

    if (!order.pdf_url) {
      throw new Error("PDF must be exported before sending to Gelato.");
    }

    const productType = getProductType(order);

    if (productType !== "colouring_book") {
      throw new Error("Gelato sending is currently only enabled for Colouring Books.");
    }

    const productUid = order.gelato_product_uid || getGelatoProductUidForOrder(order);
    const pageCount = order.gelato_page_count || getGelatoPageCountForOrder(order);

    if (!pageCount) {
      throw new Error("Could not determine Gelato page count for this order.");
    }

    const shippingAddress = getShippingAddress(order);
    const currency = getCurrency(order);

    const shipmentMethodUid =
      order.gelato_shipment_method_uid ||
      "normal";

    const payload = {
      orderType: "order",
      orderReferenceId: order.id,
      customerReferenceId: order.customer_email || order.customer_name || order.id,
      currency,
      shipmentMethodUid,
      shippingAddress,
      items: [
        {
          itemReferenceId: `${order.id}-book`,
          productUid,
          pageCount,
          files: [
            {
              type: "default",
              url: order.pdf_url,
            },
          ],
          quantity: Number(order.quantity || 1),
        },
      ],
      metadata: [
        {
          key: "memory_books_order_id",
          value: order.id,
        },
        {
          key: "product_type",
          value: productType,
        },
      ],
    };

    const gelatoOrder = await callGelatoApi(GELATO_CREATE_ORDER_URL, payload);

    const trackingUrl =
      gelatoOrder?.shipment?.packages?.[0]?.trackingUrl ||
      gelatoOrder?.shipment?.trackingUrl ||
      null;

    const { data: updatedOrder, error: updateError } = await supabaseAdmin
      .from("orders")
      .update({
        gelato_order_id: gelatoOrder?.id || null,
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

    if (updateError) {
      throw new Error(updateError.message);
    }

    return NextResponse.json({
      ok: true,
      order: updatedOrder,
      gelatoOrder,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gelato send failed.";

    await supabaseAdmin
      .from("orders")
      .update({
        gelato_status: "send_failed",
        gelato_error: message,
      })
      .eq("id", orderId);

    return NextResponse.json(
      {
        ok: false,
        error: message,
      },
      { status: 500 }
    );
  }
}
