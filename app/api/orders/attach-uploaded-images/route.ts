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

function isHeicLike(params: {
  storagePath: string;
  originalFilename: string;
  mimeType: string;
}) {
  const combined = `${params.storagePath} ${params.originalFilename} ${params.mimeType}`.toLowerCase();

  return (
    combined.includes(".heic") ||
    combined.includes(".heif") ||
    combined.includes("image/heic") ||
    combined.includes("image/heif")
  );
}

async function convertHeicToJpegBuffer(inputBuffer: Buffer) {
  const heicConvertModule = await import("heic-convert");
  const heicConvert = heicConvertModule.default || heicConvertModule;

  const output = await heicConvert({
    buffer: inputBuffer,
    format: "JPEG",
    quality: 0.95,
  });

  return Buffer.from(output);
}

async function convertToPrintSafeJpg(params: {
  inputBuffer: Buffer;
  storagePath: string;
  originalFilename: string;
  mimeType: string;
}) {
  const { inputBuffer, storagePath, originalFilename, mimeType } = params;

  const heicLike = isHeicLike({
    storagePath,
    originalFilename,
    mimeType,
  });

  if (heicLike) {
    try {
      const heicJpegBuffer = await convertHeicToJpegBuffer(inputBuffer);

      return await sharp(heicJpegBuffer, {
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
    } catch (heicError) {
      const message =
        heicError instanceof Error ? heicError.message : "Unknown HEIC error";

      throw new Error(
        `Could not convert HEIC/HEIF file ${originalFilename} into a print-safe JPG. ${message}`
      );
    }
  }

  try {
    return await sharp(inputBuffer, {
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
  } catch (sharpError) {
    const message =
      sharpError instanceof Error ? sharpError.message : "Unknown image error";

    throw new Error(
      `Could not convert ${originalFilename} into a print-safe JPG. ${message}`
    );
  }
}

async function normaliseOriginalToJpg(params: {
  storagePath: string;
  originalFilename: string;
  originalMimeType: string;
  pageNumber: number;
}) {
  const { storagePath, originalFilename, originalMimeType, pageNumber } = params;

  const { data: downloadedFile, error: downloadError } =
    await supabaseAdmin.storage.from("originals").download(storagePath);

  if (downloadError || !downloadedFile) {
    throw new Error(
      `Could not read uploaded file from storage: ${originalFilename}`
    );
  }

  const inputBuffer = Buffer.from(await downloadedFile.arrayBuffer());

  const normalisedBuffer = await convertToPrintSafeJpg({
    inputBuffer,
    storagePath,
    originalFilename,
    mimeType: originalMimeType,
  });

  const folder = getFolderFromPath(storagePath);
  const safeName = safePathPart(originalFilename.replace(/\.[^.]+$/, ""));
  const normalisedPath = [
    folder,
    "normalised",
    `page-${String(pageNumber).padStart(2, "0")}-${safeName}.jpg`,
  ]
    .filter(Boolean)
    .join("/");

  if (
    normalisedBuffer.length < 3 ||
    normalisedBuffer[0] !== 0xff ||
    normalisedBuffer[1] !== 0xd8 ||
    normalisedBuffer[2] !== 0xff
  ) {
    throw new Error(
      `Normalised JPG for ${originalFilename} was not valid JPG data before upload.`
    );
  }

  const normalisedBlob = new Blob([new Uint8Array(normalisedBuffer)], {
    type: "image/jpeg",
  });

  const { error: uploadError } = await supabaseAdmin.storage
    .from("originals")
    .upload(normalisedPath, normalisedBlob, {
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
        originalMimeType,
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
