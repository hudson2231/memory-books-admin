import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

const MAX_CAPTION_LENGTH = 180;

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  const { id: imageId } = await context.params;

  try {
    const body = await request.json();
    const rawCaption =
      typeof body?.caption_text === "string" ? body.caption_text.trim() : "";

    if (rawCaption.length > MAX_CAPTION_LENGTH) {
      return NextResponse.json(
        { error: `Caption must be ${MAX_CAPTION_LENGTH} characters or fewer.` },
        { status: 400 }
      );
    }

    const captionText = rawCaption.length > 0 ? rawCaption : null;

    const { data: image, error } = await supabaseAdmin
      .from("order_images")
      .update({
        caption_text: captionText,
        caption_source: "admin",
      })
      .eq("id", imageId)
      .select("*")
      .single();

    if (error || !image) {
      return NextResponse.json(
        { error: error?.message || "Image row not found." },
        { status: 404 }
      );
    }

    return NextResponse.json({ image });
  } catch {
    return NextResponse.json(
      { error: "Invalid caption update request." },
      { status: 400 }
    );
  }
}
