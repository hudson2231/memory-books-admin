import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: orderId } = await context.params;

  const { data: updatedImages, error } = await supabaseAdmin
    .from("order_images")
    .update({
      approved: true,
    })
    .eq("order_id", orderId)
    .not("generated_url", "is", null)
    .select("*");

  if (error) {
    return NextResponse.json(
      { error: error.message },
      { status: 500 }
    );
  }

  await supabaseAdmin
    .from("orders")
    .update({
      status: "ready_for_pdf",
      pdf_status: "not_exported",
    })
    .eq("id", orderId);

  return NextResponse.json({
    images: updatedImages || [],
    approved_count: updatedImages?.length || 0,
  });
}
