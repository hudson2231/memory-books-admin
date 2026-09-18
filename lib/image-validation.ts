import sharp from "sharp";

export const MAX_IMAGE_FILES_PER_REQUEST = 40;
export const MAX_IMAGE_ENCODED_BYTES = 25 * 1024 * 1024;
export const MAX_IMAGE_REQUEST_BYTES = 100 * 1024 * 1024;
export const MAX_IMAGE_WIDTH = 8_000;
export const MAX_IMAGE_HEIGHT = 8_000;
export const MAX_IMAGE_PIXELS = 40_000_000;

const MIME_BY_FORMAT: Record<string, string> = {
  jpeg: "image/jpeg", png: "image/png", webp: "image/webp", avif: "image/avif",
  gif: "image/gif", bmp: "image/bmp", tiff: "image/tiff", heif: "image/heif",
};
const EXTENSION_BY_FORMAT: Record<string, string> = {
  jpeg: "jpg", png: "png", webp: "webp", avif: "avif", gif: "gif", bmp: "bmp", tiff: "tiff", heif: "heif",
};

export class ImageValidationError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 422) { super(message); }
}

export type ValidatedImage = {
  format: keyof typeof MIME_BY_FORMAT; mimeType: string; extension: string;
  width: number; height: number; pixels: number; encodedBytes: number;
};

export function assertImageEncodedBytes(bytes: number, label = "Image") {
  if (!Number.isFinite(bytes) || bytes < 1) throw new ImageValidationError("IMAGE_EMPTY", label + " is empty.");
  if (bytes > MAX_IMAGE_ENCODED_BYTES) {
    throw new ImageValidationError("IMAGE_TOO_LARGE", label + " exceeds the " + (MAX_IMAGE_ENCODED_BYTES / 1024 / 1024) + "MB encoded-file limit.", 413);
  }
}

export function assertImageRequestBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes < 1) throw new ImageValidationError("IMAGE_REQUEST_EMPTY", "No image bytes were provided.");
  if (bytes > MAX_IMAGE_REQUEST_BYTES) {
    throw new ImageValidationError("IMAGE_REQUEST_TOO_LARGE", "Combined upload size exceeds the " + (MAX_IMAGE_REQUEST_BYTES / 1024 / 1024) + "MB request limit.", 413);
  }
}

export async function validateImageBuffer(bytes: Buffer, label = "Image"): Promise<ValidatedImage> {
  assertImageEncodedBytes(bytes.length, label);
  const metadata = await (async () => {
    try {
      return await sharp(bytes, { animated: false, failOn: "error", limitInputPixels: MAX_IMAGE_PIXELS }).metadata();
    } catch {
      throw new ImageValidationError("IMAGE_DECODE_FAILED", label + " is not a supported, decodable image.");
    }
  })();
  const format = metadata.format;
  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);
  if (!format || !(format in MIME_BY_FORMAT) || !width || !height) {
    throw new ImageValidationError("IMAGE_FORMAT_UNSUPPORTED", label + " must be a JPEG, PNG, WebP, AVIF, GIF, BMP, TIFF, or HEIF image.");
  }
  const pixels = width * height;
  if (width > MAX_IMAGE_WIDTH || height > MAX_IMAGE_HEIGHT || pixels > MAX_IMAGE_PIXELS) {
    throw new ImageValidationError("IMAGE_DIMENSIONS_TOO_LARGE", label + " exceeds the 8000x8000 / 40,000,000-pixel decode limit.", 413);
  }
  return { format: format as keyof typeof MIME_BY_FORMAT, mimeType: MIME_BY_FORMAT[format], extension: EXTENSION_BY_FORMAT[format], width, height, pixels, encodedBytes: bytes.length };
}
