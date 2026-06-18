import { NextResponse } from "next/server";
import crypto from "crypto";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";

const MAX_FILES = 40;
const MAX_FILE_SIZE_MB = 25;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

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
  "image/tiff",
]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function extensionFromFile(file: File) {
  const originalExtension = file.name.split(".").pop();

  if (originalExtension && /^[a-zA-Z0-9]+$/.test(originalExtension)) {
    return originalExtension.toLowerCase();
  }

  const fromMime = file.type.split("/")[1];

  if (fromMime) {
    return fromMime.toLowerCase().replace("jpeg", "jpg");
  }

  return "jpg";
}

function mimeTypeFromFile(file: File) {
  const extension = extensionFromFile(file);

  if (file.type && file.type !== "application/octet-stream") {
    return file.type;
  }

  const mimeByExtension: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    heic: "image/heic",
    heif: "image/heif",
    avif: "image/avif",
    gif: "image/gif",
    bmp: "image/bmp",
    tif: "image/tiff",
    tiff: "image/tiff",
  };

  return mimeByExtension[extension] || file.type || "application/octet-stream";
}

function makeUploadBatchId() {
  return crypto.randomBytes(16).toString("hex");
}

function jsonResponse(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: corsHeaders,
  });
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();

    const uploadBatchId =
      String(formData.get("uploadBatchId") || "").trim() || makeUploadBatchId();

    const productTitle = String(formData.get("productTitle") || "memory-book");
    const variantTitle = String(formData.get("variantTitle") || "unknown-variant");

    const files = formData
      .getAll("files")
      .filter((file): file is File => file instanceof File);

    if (files.length === 0) {
      return jsonResponse(
        {
          error: "No files uploaded.",
        },
        400
      );
    }

    if (files.length > MAX_FILES) {
      return jsonResponse(
        {
          error: `Too many files. Maximum is ${MAX_FILES}.`,
        },
        400
      );
    }

    const uploadedFiles = [];

    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];

      const detectedMimeType = mimeTypeFromFile(file);

      if (!ALLOWED_MIME_TYPES.has(detectedMimeType)) {
        return jsonResponse(
          {
            error: `Unsupported file type: ${detectedMimeType || file.type || "unknown"}.`,
            filename: file.name,
          },
          400
        );
      }

      if (file.size > MAX_FILE_SIZE_BYTES) {
        return jsonResponse(
          {
            error: `${file.name} is too large. Maximum file size is ${MAX_FILE_SIZE_MB}MB.`,
          },
          400
        );
      }

      const arrayBuffer = await file.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      const safeProduct = slugify(productTitle) || "memory-book";
      const safeVariant = slugify(variantTitle) || "variant";
      const safeFilename = slugify(file.name.replace(/\.[^.]+$/, "")) || `image-${index + 1}`;
      const extension = extensionFromFile(file);

      const storagePath = [
        "customer-uploads",
        uploadBatchId,
        safeProduct,
        safeVariant,
        `${String(index + 1).padStart(2, "0")}-${safeFilename}.${extension}`,
      ].join("/");

      const { error: uploadError } = await supabaseAdmin.storage
        .from("originals")
        .upload(storagePath, buffer, {
          contentType: detectedMimeType,
          upsert: true,
        });

      if (uploadError) {
        return jsonResponse(
          {
            error: uploadError.message,
            filename: file.name,
          },
          500
        );
      }

      const { data: publicUrlData } = supabaseAdmin.storage
        .from("originals")
        .getPublicUrl(storagePath);

      uploadedFiles.push({
        url: publicUrlData.publicUrl,
        filename: file.name,
        mime_type: detectedMimeType,
        size: file.size,
        page_number: index + 1,
        storage_path: storagePath,
      });
    }

    return jsonResponse({
      ok: true,
      upload_batch_id: uploadBatchId,
      uploaded_count: uploadedFiles.length,
      files: uploadedFiles,
    });
  } catch (error) {
    return jsonResponse(
      {
        error:
          error instanceof Error
            ? error.message
            : "Customer upload failed.",
      },
      500
    );
  }
}
