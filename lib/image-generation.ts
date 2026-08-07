import { fal } from "@fal-ai/client";
import sharp from "sharp";
import { COLORING_BOOK_PROMPT, STORYBOOK_PROMPT } from "./book-prompts";
import { supabaseAdmin } from "./supabaseAdmin";

export const GEMINI_IMAGE_MODEL =
  process.env.GEMINI_IMAGE_MODEL?.trim() || "gemini-3-pro-image";

export const FAL_COLORING_MODEL =
  process.env.FAL_COLORING_MODEL?.trim() ||
  "bytedance/seedream/v5/pro/edit";

export const COLORING_BOOK_PROMPT_VERSION = "seedream5_color_bold_v1";
export const STORYBOOK_PROMPT_VERSION = "storybook_clipart_v1";

const IMAGE_FETCH_TIMEOUT_MS = 45_000;
const GEMINI_GENERATION_TIMEOUT_MS = 180_000;

function createTimeoutSignal(timeoutMs: number) {
  const abortSignal = AbortSignal as typeof AbortSignal & {
    timeout?: (milliseconds: number) => AbortSignal;
  };

  if (typeof abortSignal.timeout === "function") {
    return abortSignal.timeout(timeoutMs);
  }

  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs);
  return controller.signal;
}

export function getProductType(order: Record<string, any>) {
  return order.product_type === "story_book" ? "story_book" : "colouring_book";
}

export function getPromptForOrder(order: Record<string, any>, image: Record<string, any>) {
  if (getProductType(order) === "story_book") {
    const caption = typeof image.caption_text === "string" ? image.caption_text.trim() : "";

    if (!caption) return STORYBOOK_PROMPT;

    return `${STORYBOOK_PROMPT}

CUSTOMER CAPTION FOR THIS PAGE:
${caption}

Use this caption as emotional and contextual guidance only. Do not render the caption text inside the illustration.`;
  }

  return COLORING_BOOK_PROMPT;
}

export function getPromptVersionForOrder(order: Record<string, any>) {
  return getProductType(order) === "story_book"
    ? STORYBOOK_PROMPT_VERSION
    : COLORING_BOOK_PROMPT_VERSION;
}

export function getMimeTypeFromUrl(url: string) {
  const lower = url.toLowerCase();

  if (lower.includes(".png")) return "image/png";
  if (lower.includes(".webp")) return "image/webp";
  if (lower.includes(".heic")) return "image/heic";
  if (lower.includes(".heif")) return "image/heif";
  if (lower.includes(".avif")) return "image/avif";
  if (lower.includes(".gif")) return "image/gif";
  if (lower.includes(".bmp")) return "image/bmp";
  if (lower.includes(".dib")) return "image/bmp";
  if (lower.includes(".tif")) return "image/tiff";
  if (lower.includes(".tiff")) return "image/tiff";
  if (lower.includes(".jfif")) return "image/jpeg";
  if (lower.includes(".pjpeg")) return "image/jpeg";
  if (lower.includes(".pjp")) return "image/jpeg";

  return "image/jpeg";
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

export function getAspectRatioForImage(image: Record<string, any>) {
  const width = Number(image.width || image.original_width || 0);
  const height = Number(image.height || image.original_height || 0);

  if (width > 0 && height > width) return "3:4";
  return "4:3";
}

async function downloadUrlToBuffer(url: string) {
  const response = await fetch(url, {
    signal: createTimeoutSignal(IMAGE_FETCH_TIMEOUT_MS),
  });

  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status}`);
  }

  const arrayBuffer = await response.arrayBuffer();
  const contentType = response.headers.get("content-type") || "image/png";

  return {
    buffer: Buffer.from(arrayBuffer),
    contentType,
  };
}

function getGeneratedExtension(contentType: string) {
  const lower = contentType.toLowerCase();

  if (lower.includes("jpeg") || lower.includes("jpg")) return "jpg";
  if (lower.includes("webp")) return "webp";
  return "png";
}

export async function uploadGeneratedBuffer(params: {
  buffer: Buffer;
  contentType?: string;
  orderFolder: string;
  pageNumber: number;
  suffix?: string;
}) {
  const contentType = params.contentType || "image/png";
  const extension = getGeneratedExtension(contentType);
  const suffix = params.suffix ? `-${params.suffix}` : "";
  const generatedPath = `${params.orderFolder}/page-${params.pageNumber}-generated${suffix}.${extension}`;

  const { error: uploadError } = await supabaseAdmin.storage
    .from("generated")
    .upload(generatedPath, params.buffer, {
      contentType,
      upsert: true,
    });

  if (uploadError) throw new Error(uploadError.message);

  const { data: publicUrlData } = supabaseAdmin.storage
    .from("generated")
    .getPublicUrl(generatedPath);

  return publicUrlData.publicUrl;
}

export async function generateStorybookWithGemini(params: {
  promptText: string;
  originalUrl: string;
  mimeType: string;
  previousGeneratedUrl?: string | null;
}) {
  const apiKey = process.env.GEMINI_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("Missing GEMINI_API_KEY.");
  }

  const originalResponse = await fetch(params.originalUrl, {
    signal: createTimeoutSignal(IMAGE_FETCH_TIMEOUT_MS),
  });

  if (!originalResponse.ok) {
    throw new Error("Failed to download original image.");
  }

  const originalArrayBuffer = await originalResponse.arrayBuffer();
  const originalBase64 = Buffer.from(originalArrayBuffer).toString("base64");

  let previousGeneratedPart: any = null;

  if (params.previousGeneratedUrl) {
    try {
      const previousResponse = await fetch(params.previousGeneratedUrl, {
        signal: createTimeoutSignal(IMAGE_FETCH_TIMEOUT_MS),
      });

      if (previousResponse.ok) {
        const previousArrayBuffer = await previousResponse.arrayBuffer();
        const previousBase64 = Buffer.from(previousArrayBuffer).toString("base64");

        previousGeneratedPart = {
          inline_data: {
            mime_type: "image/png",
            data: previousBase64,
          },
        };
      }
    } catch {
      previousGeneratedPart = null;
    }
  }

  const geminiResponse = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_IMAGE_MODEL}:generateContent?key=${encodeURIComponent(apiKey)}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      signal: createTimeoutSignal(GEMINI_GENERATION_TIMEOUT_MS),
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: params.promptText },
              {
                text: "SOURCE CUSTOMER PHOTO — this is the ground truth. Preserve the real people, likeness, scene, and important content from this image.",
              },
              {
                inline_data: {
                  mime_type: params.mimeType,
                  data: originalBase64,
                },
              },
              ...(previousGeneratedPart
                ? [
                    {
                      text: "CURRENT GENERATED PAGE — use this only as a continuity reference for what already works. Fix the requested defect without degrading successful areas.",
                    },
                    previousGeneratedPart,
                  ]
                : []),
            ],
          },
        ],
      }),
    }
  );

  const geminiData = await geminiResponse.json();

  if (!geminiResponse.ok) {
    throw new Error(geminiData?.error?.message || "Gemini generation failed.");
  }

  const parts = geminiData?.candidates?.[0]?.content?.parts || [];

  const imagePart = parts.find(
    (part: any) => part.inlineData?.data || part.inline_data?.data
  );

  const generatedBase64 =
    imagePart?.inlineData?.data || imagePart?.inline_data?.data;

  if (!generatedBase64) {
    throw new Error("Gemini did not return an image.");
  }

  return {
    buffer: Buffer.from(generatedBase64, "base64"),
    contentType: "image/png",
    modelUsed: GEMINI_IMAGE_MODEL,
  };
}

async function uploadUrlToFalStorage(url: string) {
  const downloaded = await downloadUrlToBuffer(url);
  const contentType = downloaded.contentType || "image/jpeg";

  const blob = new Blob([new Uint8Array(downloaded.buffer)], {
    type: contentType,
  });

  return await fal.storage.upload(blob);
}

async function prepareImageUrlForFal(url: string) {
  const downloaded = await downloadUrlToBuffer(url);

  const cleanJpegBuffer = await sharp(downloaded.buffer, {
    failOn: "none",
    animated: false,
  })
    .rotate()
    .flatten({ background: "#ffffff" })
    .resize({
      width: 1800,
      height: 2400,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({
      quality: 92,
      mozjpeg: true,
    })
    .toBuffer();

  const blob = new Blob([new Uint8Array(cleanJpegBuffer)], {
    type: "image/jpeg",
  });

  return await fal.storage.upload(blob);
}

export async function generateColoringWithFal(params: {
  promptText: string;
  originalUrl: string;
  aspectRatio?: string;
  previousGeneratedUrl?: string | null;
}) {
  const apiKey = process.env.FAL_KEY?.trim();

  if (!apiKey) {
    throw new Error("Missing FAL_KEY.");
  }

  fal.config({
    credentials: apiKey,
  });

  let falOriginalUrl: string;
  let falPreviousGeneratedUrl: string | null = null;

  try {
    falOriginalUrl = await prepareImageUrlForFal(params.originalUrl);

    if (params.previousGeneratedUrl) {
      falPreviousGeneratedUrl = await prepareImageUrlForFal(
        params.previousGeneratedUrl
      );
    }
  } catch (prepareError) {
    const message =
      prepareError instanceof Error
        ? prepareError.message
        : "Unknown image preparation error.";

    throw new Error(`Could not prepare image for Fal. ${message}`);
  }

  const imageUrls = falPreviousGeneratedUrl
    ? [falOriginalUrl, falPreviousGeneratedUrl]
    : [falOriginalUrl];

  let result: any;

  try {
    result = await fal.subscribe(FAL_COLORING_MODEL, {
      input: {
        prompt: params.promptText,
        image_urls: imageUrls,
        aspect_ratio: params.aspectRatio || "3:4",
      },
      logs: true,
    });
  } catch (falError) {
    const message =
      falError instanceof Error ? falError.message : "Unknown Fal error.";

    throw new Error(`Fal generation failed after clean JPG upload. ${message}`);
  }

  const outputUrl =
    result?.data?.images?.[0]?.url || result?.images?.[0]?.url;

  if (!outputUrl) {
    throw new Error("Fal returned no output image.");
  }

  const downloaded = await downloadUrlToBuffer(outputUrl);

  return {
    buffer: downloaded.buffer,
    contentType: downloaded.contentType,
    modelUsed: FAL_COLORING_MODEL,
  };
}

