import { NextResponse } from "next/server";
import crypto from "node:crypto";
import { supabaseAdmin } from "../../../lib/supabaseAdmin";
import { MAX_IMAGE_FILES_PER_REQUEST, assertImageRequestBytes, ImageValidationError, validateImageBuffer } from "../../../lib/image-validation";
import { verifyCustomerUploadAuthorization } from "../../../lib/customer-upload-token";

export const runtime = "nodejs";

function allowedOrigins() {
  return (process.env.CUSTOMER_UPLOAD_ALLOWED_ORIGINS || "").split(",").map((value) => value.trim()).filter(Boolean);
}
function corsHeaders(request: Request) {
  const configured = allowedOrigins();
  const origin = request.headers.get("origin") || "";
  if (configured.length && (!origin || !configured.includes(origin))) return null;
  return {
    "Access-Control-Allow-Origin": configured.length ? origin : "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Customer-Upload-Authorization",
    "Vary": "Origin",
  };
}
function json(body: unknown, request: Request, status = 200) {
  const headers = corsHeaders(request);
  if (!headers) return NextResponse.json({ error: "Origin is not allowed." }, { status: 403 });
  return NextResponse.json(body, { status, headers });
}
function generatedBatchId() { return crypto.randomBytes(16).toString("hex"); }
function tokenRequired() { return process.env.CUSTOMER_UPLOAD_TOKEN_REQUIRED === "true"; }

export async function OPTIONS(request: Request) {
  const headers = corsHeaders(request);
  return headers ? new NextResponse(null, { status: 204, headers }) : new NextResponse(null, { status: 403 });
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const token = String(formData.get("uploadAuthorization") || formData.get("upload_authorization") || request.headers.get("x-customer-upload-authorization") || "").trim() || null;
    const verification = verifyCustomerUploadAuthorization(token);
    if (tokenRequired() && !verification.valid) return json({ error: verification.reason }, request, 401);
    if (!verification.valid) console.warn("[customer-upload] unsigned legacy upload accepted", { fileCount: formData.getAll("files").length });

    const requestedBatch = String(formData.get("uploadBatchId") || "").trim();
    if (verification.valid && requestedBatch && requestedBatch !== verification.authorization.uploadBatchId) {
      return json({ error: "Upload batch does not match the signed authorization." }, request, 400);
    }
    const uploadBatchId = verification.valid ? verification.authorization.uploadBatchId : requestedBatch || generatedBatchId();
    const files = formData.getAll("files").filter((file): file is File => file instanceof File);
    const maxFiles = verification.valid ? Math.min(MAX_IMAGE_FILES_PER_REQUEST, verification.authorization.maxFiles) : MAX_IMAGE_FILES_PER_REQUEST;
    if (!files.length) return json({ error: "No files uploaded." }, request, 400);
    if (files.length > maxFiles) return json({ error: "Too many files. Maximum is " + maxFiles + "." }, request, 400);
    assertImageRequestBytes(files.reduce((total, file) => total + file.size, 0));

    const prepared = [] as Array<{ file: File; bytes: Buffer; mimeType: string; extension: string }>;
    for (const file of files) {
      const bytes = Buffer.from(await file.arrayBuffer());
      const image = await validateImageBuffer(bytes, file.name || "Uploaded image");
      prepared.push({ file, bytes, mimeType: image.mimeType, extension: image.extension });
    }

    const requestFolder = crypto.randomUUID();
    const uploaded = [] as Array<Record<string, unknown>>;
    for (let index = 0; index < prepared.length; index += 1) {
      const item = prepared[index];
      const storagePath = "customer-uploads/" + requestFolder + "/" + crypto.randomUUID() + "." + item.extension;
      const { error } = await supabaseAdmin.storage.from("originals").upload(storagePath, item.bytes, { contentType: item.mimeType, upsert: false });
      if (error) throw new Error("CUSTOMER_UPLOAD_STORAGE: " + error.message);
      const { data } = supabaseAdmin.storage.from("originals").getPublicUrl(storagePath);
      uploaded.push({ url: data.publicUrl, filename: item.file.name, mime_type: item.mimeType, size: item.bytes.length, page_number: index + 1, storage_path: storagePath });
    }
    return json({ ok: true, upload_batch_id: uploadBatchId, uploaded_count: uploaded.length, files: uploaded, authorization: verification.valid ? "signed" : "legacy_unsigned" }, request);
  } catch (error) {
    const status = error instanceof ImageValidationError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Customer upload failed.";
    return json({ error: message }, request, status);
  }
}
