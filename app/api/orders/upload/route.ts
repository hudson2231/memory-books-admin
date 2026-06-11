import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

const ALLOWED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "image/avif",
  "image/gif",
  "image/bmp",
  "image/x-ms-bmp",
  "image/tiff",
  "image/x-tiff",
]);

const EXTENSION_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  avif: "image/avif",
  gif: "image/gif",
  bmp: "image/bmp",
  dib: "image/bmp",
  tif: "image/tiff",
  tiff: "image/tiff",
  jfif: "image/jpeg",
  pjpeg: "image/jpeg",
  pjp: "image/jpeg",
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function getFileExtension(fileName: string) {
  const cleanName = fileName.toLowerCase().split("?")[0];
  const parts = cleanName.split(".");
  return parts.length > 1 ? parts.pop() || "" : "";
}

function getMimeTypeFromFile(file: File) {
  const extension = getFileExtension(file.name);
  return file.type || EXTENSION_TO_MIME[extension] || "application/octet-stream";
}

function isSupportedImage(file: File) {
  const extension = getFileExtension(file.name);
  const mimeType = getMimeTypeFromFile(file);

  return ALLOWED_MIME_TYPES.has(mimeType) || extension in EXTENSION_TO_MIME;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();

    const orderId = formData.get("order_id");

    if (!orderId || typeof orderId !== "string") {
      return NextResponse.json(
        { error: "order_id is required." },
        { status: 400 }
      );
    }

    const files = formData.getAll("files");

    if (!files.length) {
      return NextResponse.json(
        { error: "At least one image file is required." },
        { status: 400 }
      );
    }

    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .select("id, customer_name")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      return NextResponse.json(
        { error: "Order not found." },
        { status: 404 }
      );
    }

    const orderSlug = slugify(order.customer_name || "order");
    const shortOrderId = order.id.slice(0, 8);
    const orderFolder = `${orderSlug}-${shortOrderId}`;

    const uploadedImages = [];

    for (let index = 0; index < files.length; index++) {
      const file = files[index];

      if (!(file instanceof File)) {
        continue;
      }

      if (!isSupportedImage(file)) {
        return NextResponse.json(
          { error: `Unsupported image format: ${file.name}` },
          { status: 400 }
        );
      }

      const fileExtension = getFileExtension(file.name) || "jpg";
      const mimeType = getMimeTypeFromFile(file);

      const safeFileName = `${orderFolder}/page-${index + 1}-original.${fileExtension}`;

      const arrayBuffer = await file.arrayBuffer();
      const fileBuffer = Buffer.from(arrayBuffer);

      const { error: uploadError } = await supabaseAdmin.storage
        .from("originals")
        .upload(safeFileName, fileBuffer, {
          contentType: mimeType,
          upsert: true,
        });

      if (uploadError) {
        return NextResponse.json(
          { error: uploadError.message },
          { status: 500 }
        );
      }

      const { data: publicUrlData } = supabaseAdmin.storage
        .from("originals")
        .getPublicUrl(safeFileName);

      const originalUrl = publicUrlData.publicUrl;

      const { data: imageRow, error: dbError } = await supabaseAdmin
        .from("order_images")
        .insert({
          order_id: orderId,
          original_url: originalUrl,
          original_filename: file.name,
          mime_type: mimeType,
          page_number: index + 1,
          status: "uploaded",
        })
        .select("*")
        .single();

      if (dbError) {
        return NextResponse.json(
          { error: dbError.message },
          { status: 500 }
        );
      }

      uploadedImages.push(imageRow);
    }

    return NextResponse.json({ images: uploadedImages });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      { error: "Image upload failed." },
      { status: 500 }
    );
  }
}
