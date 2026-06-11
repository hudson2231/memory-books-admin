import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../lib/supabaseAdmin";

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

    return NextResponse.json({ image });
  } catch {
    return NextResponse.json(
      { error: "Invalid approval request." },
      { status: 400 }
    );
  }
}
