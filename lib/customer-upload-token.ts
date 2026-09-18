import crypto from "node:crypto";

export type CustomerUploadAuthorization = {
  uploadBatchId: string; customizationId?: string; pageCount?: 20 | 32 | 40;
  maxFiles: number; exp: number; nonce: string;
};
export type CustomerUploadTokenVerification =
  | { valid: true; authorization: CustomerUploadAuthorization }
  | { valid: false; reason: string };

function secret() { return process.env.CUSTOMER_UPLOAD_SIGNING_SECRET?.trim() || ""; }
function sign(payload: string, key: string) { return crypto.createHmac("sha256", key).update(payload).digest("base64url"); }

export function createCustomerUploadAuthorization(input: Omit<CustomerUploadAuthorization, "exp" | "nonce">) {
  const key = secret();
  if (!key) throw new Error("CUSTOMER_UPLOAD_SIGNING_SECRET is not configured.");
  const authorization: CustomerUploadAuthorization = { ...input, exp: Math.floor(Date.now() / 1000) + 15 * 60, nonce: crypto.randomBytes(16).toString("hex") };
  const payload = Buffer.from(JSON.stringify(authorization)).toString("base64url");
  return payload + "." + sign(payload, key);
}

export function verifyCustomerUploadAuthorization(token: string | null | undefined): CustomerUploadTokenVerification {
  const key = secret();
  if (!key) return { valid: false, reason: "CUSTOMER_UPLOAD_SIGNING_SECRET is not configured." };
  if (!token) return { valid: false, reason: "Missing upload authorization token." };
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra) return { valid: false, reason: "Malformed upload authorization token." };
  const expected = Buffer.from(sign(payload, key), "utf8");
  const actual = Buffer.from(signature, "utf8");
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) return { valid: false, reason: "Invalid upload authorization signature." };
  try {
    const authorization = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as CustomerUploadAuthorization;
    if (!authorization.uploadBatchId || !Number.isInteger(authorization.maxFiles) || authorization.maxFiles < 1 || !Number.isFinite(authorization.exp) || authorization.exp <= Math.floor(Date.now() / 1000)) {
      return { valid: false, reason: "Expired or invalid upload authorization." };
    }
    return { valid: true, authorization };
  } catch { return { valid: false, reason: "Malformed upload authorization payload." }; }
}
