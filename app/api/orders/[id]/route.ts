import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export async function GET(
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
    return NextResponse.json(
      { error: "Order not found." },
      { status: 404 }
    );
  }

  const { data: images, error: imagesError } = await supabaseAdmin
    .from("order_images")
    .select("*")
    .eq("order_id", orderId)
    .order("page_number", { ascending: true });

  if (imagesError) {
    return NextResponse.json(
      { error: imagesError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    order,
    images: images || [],
  });
}

export async function DELETE(
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
    return NextResponse.json(
      { error: "Order not found." },
      { status: 404 }
    );
  }

  const { error: imagesDeleteError } = await supabaseAdmin
    .from("order_images")
    .delete()
    .eq("order_id", orderId);

  if (imagesDeleteError) {
    return NextResponse.json(
      { error: imagesDeleteError.message },
      { status: 500 }
    );
  }

  const { error: orderDeleteError } = await supabaseAdmin
    .from("orders")
    .delete()
    .eq("id", orderId);

  if (orderDeleteError) {
    return NextResponse.json(
      { error: orderDeleteError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    deleted_order_id: orderId,
  });
}
