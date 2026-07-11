import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

export async function GET() {
  const { data: orders, error: ordersError } = await supabaseAdmin
    .from("orders")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);

  if (ordersError) {
    return NextResponse.json(
      { error: ordersError.message },
      { status: 500 }
    );
  }

  const orderIds = (orders || []).map((order) => order.id);

  if (orderIds.length === 0) {
    return NextResponse.json({ orders: [] });
  }

  const { data: images, error: imagesError } = await supabaseAdmin
    .from("order_images")
    .select("order_id, status, generated_url, approved")
    .in("order_id", orderIds);

  if (imagesError) {
    return NextResponse.json(
      { error: imagesError.message },
      { status: 500 }
    );
  }

  const ordersWithCounts = (orders || []).map((order) => {
    const orderImages = (images || []).filter(
      (image) => image.order_id === order.id
    );

    const imageCount = orderImages.length;

    const generatedCount = orderImages.filter(
      (image) => image.generated_url || image.status === "generated"
    ).length;

    const approvedCount = orderImages.filter(
      (image) => image.approved
    ).length;

    const generatingCount = orderImages.filter(
      (image) => image.status === "generating"
    ).length;

    const failedCount = orderImages.filter(
      (image) => image.status === "failed"
    ).length;

    const uploadedCount = orderImages.filter(
      (image) => image.status === "uploaded"
    ).length;

    return {
      ...order,
      image_count: imageCount,
      generated_count: generatedCount,
      approved_count: approvedCount,
      generating_count: generatingCount,
      failed_count: failedCount,
      uploaded_count: uploadedCount,
    };
  });

  return NextResponse.json({ orders: ordersWithCounts });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const customerName = body.customer_name;
    const customerEmail = body.customer_email;
    const pageCount = Number(body.page_count || 20);

    if (!customerName || !customerEmail) {
      return NextResponse.json(
        { error: "Customer name and email are required." },
        { status: 400 }
      );
    }

    const { data, error } = await supabaseAdmin
      .from("orders")
      .insert({
        customer_name: customerName,
        customer_email: customerEmail,
        page_count: pageCount,
        status: "created",
        pdf_status: "not_exported",
        product_type: "colouring_book",
      })
      .select("*")
      .single();

    if (error) {
      return NextResponse.json(
        { error: error.message },
        { status: 500 }
      );
    }

    return NextResponse.json({ order: data });
  } catch {
    return NextResponse.json(
      { error: "Invalid request." },
      { status: 400 }
    );
  }
}
