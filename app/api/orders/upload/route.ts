import crypto from "crypto";
import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";
import {
  assertImageRequestBytes,
  ImageValidationError,
  MAX_IMAGE_FILES_PER_REQUEST,
  validateImageBuffer,
} from "../../../../lib/image-validation";

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const orderId = formData.get("order_id");

    if (!orderId || typeof orderId !== "string") {
      return NextResponse.json({ error: "order_id is required." }, { status: 400 });
    }

    const files = formData.getAll("files").filter((value): value is File => value instanceof File);
    if (!files.length) {
      return NextResponse.json({ error: "At least one image file is required." }, { status: 400 });
    }
    if (files.length > MAX_IMAGE_FILES_PER_REQUEST) {
      return NextResponse.json({ error: "Too many image files in one request." }, { status: 413 });
    }
    assertImageRequestBytes(files.reduce((total, file) => total + file.size, 0));

    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .select("id, customer_name")
      .eq("id", orderId)
      .single();
    if (orderError || !order) {
      return NextResponse.json({ error: "Order not found." }, { status: 404 });
    }

    const { data: existingImages, error: existingError } = await supabaseAdmin
      .from("order_images")
      .select("page_number")
      .eq("order_id", orderId);
    if (existingError) throw new Error(existingError.message);
    const startPage = Math.max(0, ...(existingImages || []).map((image) => Number(image.page_number) || 0)) + 1;

    const orderFolder = slugify(order.customer_name || "order") + "-" + order.id.slice(0, 8);
    const uploadedImages = [];

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const fileBuffer = Buffer.from(await file.arrayBuffer());
      const validated = await validateImageBuffer(
        fileBuffer,
        file.name || "admin-upload"
      );
      const storagePath = orderFolder + "/manual-uploads/" + crypto.randomUUID() + "." + validated.extension;

      const { error: uploadError } = await supabaseAdmin.storage
        .from("originals")
        .upload(storagePath, fileBuffer, {
          contentType: validated.mimeType,
          upsert: false,
        });
      if (uploadError) throw new Error(uploadError.message);

      const { data: publicUrlData } = supabaseAdmin.storage
        .from("originals")
        .getPublicUrl(storagePath);
      const { data: imageRow, error: dbError } = await supabaseAdmin
        .from("order_images")
        .insert({
          order_id: orderId,
          original_url: publicUrlData.publicUrl,
          original_filename: file.name,
          mime_type: validated.mimeType,
          page_number: startPage + index,
          status: "uploaded",
        })
        .select("*")
        .single();
      if (dbError) throw new Error(dbError.message);
      uploadedImages.push(imageRow);
    }

    return NextResponse.json({ images: uploadedImages });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Image upload failed.";
    const status = error instanceof ImageValidationError ? error.status : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
