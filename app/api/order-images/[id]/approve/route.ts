import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

async function updateOrderReviewStatus(orderId: string) {
  const { data: images } = await supabaseAdmin
    .from("order_images")
    .select("generated_url, approved")
    .eq("order_id", orderId);

  const generatedImages = (images || []).filter((image) => image.generated_url);
  const approvedImages = generatedImages.filter((image) => image.approved);

  let status = "needs_review";

  if (generatedImages.length > 0 && approvedImages.length === generatedImages.length) {
    status = "ready_for_pdf";
  }

  await supabaseAdmin
    .from("orders")
    .update({
      status,
      pdf_status: "not_exported",
    })
    .eq("id", orderId);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: imageId } = await context.params;

  try {
    const body = await request.json();
    const approved = Boolean(body.approved);

    const { data: image, error } = await supabaseAdmin
      .from("order_images")
      .update({
        approved,
      })
      .eq("id", imageId)
      .select("*")
      .single();

    if (error || !image) {
      return NextResponse.json(
        { error: error?.message || "Image not found." },
        { status: 404 }
      );
    }

    await updateOrderReviewStatus(image.order_id);

    return NextResponse.json({ image });
  } catch {
    return NextResponse.json(
      { error: "Invalid approval request." },
      { status: 400 }
    );
  }
}
