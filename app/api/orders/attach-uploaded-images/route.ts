import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const orderId = body.order_id;
    const images = Array.isArray(body.images) ? body.images : [];

    if (!orderId || typeof orderId !== "string") {
      return NextResponse.json(
        { error: "order_id is required." },
        { status: 400 }
      );
    }

    if (images.length === 0) {
      return NextResponse.json(
        { error: "At least one uploaded image is required." },
        { status: 400 }
      );
    }

    const rows = images.map((image: any, index: number) => ({
      order_id: orderId,
      original_url: image.public_url,
      original_filename: image.filename || `image-${index + 1}`,
      mime_type: image.mime_type || "image/jpeg",
      page_number: image.page_number || index + 1,
      status: "uploaded",
    }));

    const { data, error } = await supabaseAdmin
      .from("order_images")
      .insert(rows)
      .select("*");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ images: data || [] });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to attach uploaded images.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
