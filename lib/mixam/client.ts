import type {
  MixamItemSpecification,
  MixamOfferResponse,
  MixamProduct,
  MixamProductMetadata,
  MixamDeliveryRatesResponse,
  MixamOrder,
} from "./types";

const DEFAULT_TIMEOUT_MS = 20_000;
type MixamCredentials = { baseUrl: string; username: string; password: string };
type MixamToken = { token: string; expiresAt: number };
let cachedToken: MixamToken | null = null;

function getCredentials(): MixamCredentials {
  const baseUrl = process.env.MIXAM_API_BASE_URL?.replace(/\/$/, "");
  const username = process.env.MIXAM_API_USERNAME;
  const password = process.env.MIXAM_API_PASSWORD;
  const missing = [
    !baseUrl && "MIXAM_API_BASE_URL",
    !username && "MIXAM_API_USERNAME",
    !password && "MIXAM_API_PASSWORD",
  ].filter(Boolean);
  if (missing.length) throw new Error(`Mixam API is not configured: ${missing.join(", ")}.`);
  return { baseUrl: baseUrl!, username: username!, password: password! };
}

function decodeJwtExpiry(token: string) {
  try {
    const [, payload] = token.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return typeof decoded.exp === "number" ? decoded.exp * 1000 : null;
  } catch {
    return null;
  }
}

function extractToken(payload: unknown) {
  if (typeof payload === "string" && payload) return payload;
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  for (const key of ["token", "jwt", "accessToken", "access_token"]) {
    if (typeof record[key] === "string" && record[key]) return record[key] as string;
  }
  return null;
}

async function request<T>(path: string, init: RequestInit = {}, requiresAuth = true): Promise<T> {
  const credentials = getCredentials();
  const headers = new Headers(init.headers);
  headers.set("Accept", "application/json");
  if (init.body) headers.set("Content-Type", "application/json");
  if (requiresAuth) headers.set("Authorization", `Bearer ${await getMixamJwt()}`);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Number(process.env.MIXAM_API_TIMEOUT_MS || DEFAULT_TIMEOUT_MS));
  try {
    const response = await fetch(`${credentials.baseUrl}${path}`, { ...init, headers, signal: controller.signal, cache: "no-store" });
    const body = await response.text();
    let parsed: unknown = null;
    try { parsed = body ? JSON.parse(body) : null; } catch { parsed = body; }
    if (!response.ok) {
      throw new Error(`Mixam API ${path} failed with HTTP ${response.status}: ${typeof parsed === "string" ? parsed.slice(0, 500) : JSON.stringify(parsed)}`);
    }
    return parsed as T;
  } finally {
    clearTimeout(timeout);
  }
}

export async function getMixamJwt(forceRefresh = false) {
  if (!forceRefresh && cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;
  const credentials = getCredentials();
  const auth = Buffer.from(`${credentials.username}:${credentials.password}`).toString("base64");
  // Mixam returns a raw text JWT. Requesting JSON causes HTTP 406.
  const response = await fetch(`${credentials.baseUrl}/api/user/token`, {
    method: "GET",
    headers: { Authorization: "Basic " + auth, Accept: "text/plain" },
    cache: "no-store",
  });
  const rawToken = await response.text();
  if (!response.ok) {
    throw new Error(`Mixam token request failed with HTTP ${response.status}.`);
  }
  const token = extractToken(rawToken.trim());
  if (!token) throw new Error("Mixam token endpoint returned no JWT token.");
  cachedToken = { token, expiresAt: decodeJwtExpiry(token) ?? Date.now() + 15 * 60_000 };
  return token;
}

export function getMixamProducts() { return request<MixamProduct[]>("/api/public/products"); }
export function getMixamCatalogue() { return request<Record<string, unknown>>("/api/public/catalogue"); }
export async function getMixamProductMetadata(productId: number, subProductId: number, quoteType = "QUOTE") {
  const response = await request<{ productMetadata?: MixamProductMetadata } | MixamProductMetadata>(
    `/api/public/products/metadata/${productId}/${subProductId}?quoteType=${encodeURIComponent(quoteType)}`
  );
  const metadata = ("productMetadata" in response ? response.productMetadata : response) as MixamProductMetadata | undefined;
  if (!metadata?.initialSpecification) throw new Error("Mixam metadata response did not include productMetadata.initialSpecification.");
  return metadata;
}
export function getMixamItemSpecification(universalKey: string) {
  return request<MixamItemSpecification>(`/api/public/item-specification/${encodeURIComponent(universalKey)}`);
}
export function getMixamOffer(input: { productId: number; subProductId: number; productName: string; quoteType: string; itemSpecification: MixamItemSpecification }) {
  return request<MixamOfferResponse>("/api/public/offers", { method: "POST", body: JSON.stringify(input) });
}

export function createMixamOrder(payload: Record<string, unknown>) {
  return request<Record<string, unknown>>("/api/public/orders", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function getMixamOrder(orderId: string) {
  const response = await request<{ order?: MixamOrder } | MixamOrder>(`/api/public/orders/${encodeURIComponent(orderId)}`);
  return "order" in response && response.order ? response.order : response as MixamOrder;
}

export function getMixamDeliveryRates(orderId: string, destinationId: string, deliveryGroupId: string) {
  return request<MixamDeliveryRatesResponse>(
    `/api/public/orders/${encodeURIComponent(orderId)}/destinations/${encodeURIComponent(destinationId)}/delivery-groups/${encodeURIComponent(deliveryGroupId)}/available-rates`
  );
}

export function selectMixamDeliveryRate(orderId: string, destinationId: string, deliveryGroupId: string, rateId: string) {
  return request<null>(
    `/api/public/orders/${encodeURIComponent(orderId)}/destinations/${encodeURIComponent(destinationId)}/delivery-groups/${encodeURIComponent(deliveryGroupId)}/selected-rate/${encodeURIComponent(rateId)}`,
    { method: "PATCH" }
  );
}

export function getMixamUserOrders() {
  return request<{ orders?: Array<Record<string, unknown>> }>("/api/public/user/orders");
}
