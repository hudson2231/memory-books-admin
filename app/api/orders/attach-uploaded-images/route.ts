import { NextResponse } from "next/server";
import sharp from "sharp";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type UploadedFileInput = {
  storagePath?: string;
  storage_path?: string;
  path?: string;
  originalFilename?: string;
  original_filename?: string;
  filename?: string;
  name?: string;
  mimeType?: string;
  mime_type?: string;
  pageNumber?: number;
  page_number?: number;
};

function getStoragePath(file: UploadedFileInput) {
  return file.storagePath || file.storage_path || file.path || "";
}

function getOriginalFilename(file: UploadedFileInput, index: number) {
  return (
    file.originalFilename ||
    file.original_filename ||
    file.filename ||
    file.name ||
    `image-${index + 1}`
  );
}

function getMimeType(file: UploadedFileInput) {
  return file.mimeType || file.mime_type || "image/jpeg";
}

function getPageNumber(file: UploadedFileInput, index: number) {
  const value = file.pageNumber ?? file.page_number ?? index + 1;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0
    ? numberValue
    : index + 1;
}

function safePathPart(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function getFolderFromPath(storagePath: string) {
  const parts = storagePath.split("/").filter(Boolean);
  parts.pop();
  return parts.join("/");
}

async function normaliseOriginalToJpg(params: {
  storagePath: string;
  originalFilename: string;
  pageNumber: number;
}) {
  const { storagePath, originalFilename, pageNumber } = params;

  const { data: downloadedFile, error: downloadError } =
    await supabaseAdmin.storage.from("originals").download(storagePath);

  if (downloadError || !downloadedFile) {
    throw new Error(
      `Could not read uploaded file from storage: ${originalFilename}`
    );
  }

  const inputBuffer = Buffer.from(await downloadedFile.arrayBuffer());

  let normalisedBuffer: Buffer;

  try {
    normalisedBuffer = await sharp(inputBuffer, {
      failOn: "none",
      animated: false,
    })
      .rotate()
      .flatten({ background: "#ffffff" })
      .jpeg({
        quality: 95,
        mozjpeg: true,
      })
      .toBuffer();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";

    throw new Error(
      `Could not convert ${originalFilename} into a print-safe JPG. ${message}`
    );
  }

  const folder = getFolderFromPath(storagePath);
  const safeName = safePathPart(originalFilename.replace(/\.[^.]+$/, ""));
  const normalisedPath = [
    folder,
    "normalised",
    `page-${String(pageNumber).padStart(2, "0")}-${safeName}.jpg`,
  ]
    .filter(Boolean)
    .join("/");

  const { error: uploadError } = await supabaseAdmin.storage
    .from("originals")
    .upload(normalisedPath, normalisedBuffer, {
      contentType: "image/jpeg",
      upsert: true,
    });

  if (uploadError) {
    throw new Error(
      `Could not save normalised JPG for ${originalFilename}: ${uploadError.message}`
    );
  }

  const { data: publicUrlData } = supabaseAdmin.storage
    .from("originals")
    .getPublicUrl(normalisedPath);

  return {
    normalisedPath,
    publicUrl: publicUrlData.publicUrl,
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const orderId = body.order_id || body.orderId;

    const files =
      Array.isArray(body.files)
        ? body.files
        : Array.isArray(body.uploadedFiles)
          ? body.uploadedFiles
          : Array.isArray(body.uploaded_files)
            ? body.uploaded_files
            : Array.isArray(body.images)
              ? body.images
              : [];

    if (!orderId || typeof orderId !== "string") {
      return NextResponse.json(
        { error: "order_id is required." },
        { status: 400 }
      );
    }

    if (files.length === 0) {
      return NextResponse.json(
        { error: "No uploaded files were supplied." },
        { status: 400 }
      );
    }

    const { data: order, error: orderError } = await supabaseAdmin
      .from("orders")
      .select("id")
      .eq("id", orderId)
      .single();

    if (orderError || !order) {
      return NextResponse.json(
        { error: "Order not found." },
        { status: 404 }
      );
    }

    const preparedRows = [];

    for (let index = 0; index < files.length; index++) {
      const file = files[index] as UploadedFileInput;

      const storagePath = getStoragePath(file);
      const originalFilename = getOriginalFilename(file, index);
      const originalMimeType = getMimeType(file);
      const pageNumber = getPageNumber(file, index);

      if (!storagePath) {
        throw new Error(`Missing storage path for ${originalFilename}.`);
      }

      const normalised = await normaliseOriginalToJpg({
        storagePath,
        originalFilename,
        pageNumber,
      });

      preparedRows.push({
        order_id: orderId,
        original_url: normalised.publicUrl,
        original_filename: originalFilename,
        mime_type: "image/jpeg",
        page_number: pageNumber,
        status: "uploaded",
      });
    }

    const { data: insertedImages, error: insertError } = await supabaseAdmin
      .from("order_images")
      .insert(preparedRows)
      .select("*");

    if (insertError) {
      throw new Error(insertError.message);
    }

    return NextResponse.json({
      ok: true,
      images: insertedImages || [],
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to attach uploaded images.";

    console.error("Attach uploaded images failed:", message);

    return NextResponse.json(
      {
        error: message,
      },
      { status: 500 }
    );
  }
}
