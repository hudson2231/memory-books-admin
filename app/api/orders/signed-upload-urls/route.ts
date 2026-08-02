import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

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

function getMimeType(fileName: string, fileType?: string) {
  const extension = getFileExtension(fileName);
  return fileType || EXTENSION_TO_MIME[extension] || "application/octet-stream";
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const orderId = body.order_id;
    const files = Array.isArray(body.files) ? body.files : [];

    if (!orderId || typeof orderId !== "string") {
      return NextResponse.json(
        { error: "order_id is required." },
        { status: 400 }
      );
    }

    if (files.length === 0) {
      return NextResponse.json(
        { error: "At least one file is required." },
        { status: 400 }
      );
    }

    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .select("id, customer_name")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      return NextResponse.json({ error: "Order not found." }, { status: 404 });
    }

    const orderSlug = slugify(order.customer_name || "order");
    const shortOrderId = order.id.slice(0, 8);
    const orderFolder = `${orderSlug}-${shortOrderId}`;

    const uploads = [];

    for (let index = 0; index < files.length; index++) {
      const file = files[index] || {};
      const filename =
        typeof file.name === "string" && file.name.trim()
          ? file.name.trim()
          : `image-${index + 1}.jpg`;

      const extension = getFileExtension(filename) || "jpg";
      const mimeType = getMimeType(filename, file.type);

      const path = `${orderFolder}/page-${index + 1}-original.${extension}`;

      const { data: signedData, error: signedError } =
        await supabaseAdmin.storage
          .from("originals")
          .createSignedUploadUrl(path, {
            upsert: true,
          });

      if (signedError || !signedData) {
        return NextResponse.json(
          { error: signedError?.message || "Failed to create signed upload URL." },
          { status: 500 }
        );
      }

      const { data: publicUrlData } = supabaseAdmin.storage
        .from("originals")
        .getPublicUrl(path);

      uploads.push({
        path,
        token: signedData.token,
        public_url: publicUrlData.publicUrl,
        filename,
        mime_type: mimeType,
        page_number: index + 1,
      });
    }

    return NextResponse.json({ uploads });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to create upload URLs.";

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
