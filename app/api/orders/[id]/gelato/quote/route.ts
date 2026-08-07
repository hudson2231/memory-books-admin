import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../../lib/supabaseAdmin";
import {
  GELATO_QUOTE_URL,
  callGelatoApi,
  getCurrency,
  getGelatoPageCountForOrder,
  getGelatoProductUidForOrder,
  getProductType,
  getShippingAddress,
  pickBestShipmentMethod,
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
    if (!order.pdf_url) {
      throw new Error("PDF must be exported before requesting a Gelato quote.");
    }

    const productType = getProductType(order);

    const productUid = getGelatoProductUidForOrder(order);
    const pageCount = getGelatoPageCountForOrder(order);

    if (!pageCount) {
      throw new Error("Could not determine Gelato page count for this order.");
    }

    const shippingAddress = getShippingAddress(order);
    const currency = getCurrency(order);

    const payload = {
      orderReferenceId: order.id,
      customerReferenceId: order.customer_email || order.customer_name || order.id,
      currency,
      allowMultipleQuotes: false,
      recipient: shippingAddress,
      products: [
        {
          itemReferenceId: `${order.id}-book`,
          productUid,
          fileUrl: order.pdf_url,
          pageCount,
          quantity: Number(order.quantity || 1),
        },
      ],
    };

    const quoteResponse = await callGelatoApi(GELATO_QUOTE_URL, payload);
    const quote = quoteResponse?.quotes?.[0];
    const shipmentMethod = pickBestShipmentMethod(quoteResponse);

    const productPrice = Number(quote?.products?.[0]?.price || 0);
    const shippingPrice = Number(shipmentMethod?.price || 0);
    const quoteTotal = productPrice + shippingPrice;

    const { data: updatedOrder, error: updateError } = await supabaseAdmin
      .from("orders")
      .update({
        gelato_status: "quoted",
        gelato_product_uid: productUid,
        gelato_page_count: pageCount,
        gelato_shipment_method_uid: shipmentMethod.shipmentMethodUid,
        gelato_quote_id: quote?.id || null,
        gelato_quote_currency: shipmentMethod.currency || currency,
        gelato_quote_total: quoteTotal,
        gelato_error: null,
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
      quote: quoteResponse,
      selectedShipmentMethod: shipmentMethod,
      estimatedTotal: quoteTotal,
      currency: shipmentMethod.currency || currency,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gelato quote failed.";

    await supabaseAdmin
      .from("orders")
      .update({
        gelato_status: "quote_failed",
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
