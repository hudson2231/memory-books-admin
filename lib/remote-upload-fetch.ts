import { lookup } from "node:dns/promises";
import net from "node:net";
import { MAX_IMAGE_ENCODED_BYTES } from "./image-validation";

const OBSERVED_UPLOAD_HOSTS = ["0ubpw0-0g.myshopify.com", "asvcrlepfiriupyfnzbi.supabase.co", "cdn.shopify.com-uploadkit.app", "ucarecdn.com"];
const MAX_REDIRECTS = 3;
const REMOTE_TIMEOUT_MS = 20_000;

export class RemoteUploadFetchError extends Error {
  constructor(public readonly code: string, message: string, public readonly status = 400) { super(message); }
}

function configuredHosts() {
  const configured = (process.env.SHOPIFY_UPLOAD_ALLOWED_HOSTS || "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  let supabaseHost = "";
  try { supabaseHost = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "").hostname.toLowerCase(); } catch {}
  return new Set([...OBSERVED_UPLOAD_HOSTS, ...configured, supabaseHost].filter(Boolean));
}

function blockedIpv4(address: string) {
  const values = address.split(".").map(Number);
  if (values.length !== 4 || values.some((value) => !Number.isInteger(value) || value < 0 || value > 255)) return true;
  const [a, b] = values;
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168)) || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0);
}
function blockedIpv6(address: string) {
  const value = address.toLowerCase();
  return value === "::" || value === "::1" || value.startsWith("fc") || value.startsWith("fd") || /^fe[89ab]/.test(value) || value.startsWith("::ffff:") || value.startsWith("2001:db8:");
}
export function isPublicIpAddress(address: string) {
  const kind = net.isIP(address);
  return kind === 4 ? !blockedIpv4(address) : kind === 6 ? !blockedIpv6(address) : false;
}

export function validateRemoteUploadUrl(value: string, allowedHosts = configuredHosts()) {
  let url: URL;
  try { url = new URL(value); } catch { throw new RemoteUploadFetchError("REMOTE_URL_INVALID", "Upload URL is invalid."); }
  if (url.protocol !== "https:") throw new RemoteUploadFetchError("REMOTE_URL_SCHEME", "Upload URL must use HTTPS.");
  const hostname = url.hostname.toLowerCase();
  if (!allowedHosts.has(hostname)) throw new RemoteUploadFetchError("REMOTE_URL_HOST", "Upload host " + hostname + " is not an approved provider.");
  if (net.isIP(hostname) && !isPublicIpAddress(hostname)) throw new RemoteUploadFetchError("REMOTE_URL_PRIVATE_IP", "Upload URL resolves to a non-public address.");
  return url;
}

async function assertPublicDns(hostname: string) {
  if (net.isIP(hostname)) { if (!isPublicIpAddress(hostname)) throw new RemoteUploadFetchError("REMOTE_DNS_PRIVATE", "Upload URL resolves to a non-public address."); return; }
  let addresses: Array<{ address: string }>;
  try { addresses = await lookup(hostname, { all: true, verbatim: true }); } catch { throw new RemoteUploadFetchError("REMOTE_DNS_FAILED", "Approved upload host could not be resolved."); }
  if (!addresses.length || addresses.some(({ address }) => !isPublicIpAddress(address))) throw new RemoteUploadFetchError("REMOTE_DNS_PRIVATE", "Upload host resolved to a non-public address.");
}

export async function readLimitedRemoteBody(body: ReadableStream<Uint8Array> | null, maxBytes = MAX_IMAGE_ENCODED_BYTES) {
  if (!body) throw new RemoteUploadFetchError("REMOTE_BODY_EMPTY", "Remote upload response was empty.");
  const reader = body.getReader(); const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); throw new RemoteUploadFetchError("REMOTE_BODY_TOO_LARGE", "Remote upload exceeds the encoded-file limit.", 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!size) throw new RemoteUploadFetchError("REMOTE_BODY_EMPTY", "Remote upload response was empty.");
  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

export async function fetchApprovedRemoteUpload(input: { url: string; maxBytes?: number; allowedHosts?: Set<string> }) {
  const allowedHosts = input.allowedHosts || configuredHosts(); let current = input.url;
  for (let redirects = 0; redirects <= MAX_REDIRECTS; redirects += 1) {
    const url = validateRemoteUploadUrl(current, allowedHosts); await assertPublicDns(url.hostname);
    let response: Response;
    try { response = await fetch(url, { redirect: "manual", signal: AbortSignal.timeout(REMOTE_TIMEOUT_MS), headers: { Accept: "image/avif,image/webp,image/apng,image/*,text/html;q=0.8,*/*;q=0.1", "User-Agent": "MemoryBooksUploadImporter/1.0" } }); }
    catch { throw new RemoteUploadFetchError("REMOTE_TIMEOUT", "Approved upload host did not respond in time.", 504); }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new RemoteUploadFetchError("REMOTE_REDIRECT_INVALID", "Remote upload redirect had no destination.");
      current = new URL(location, url).toString(); continue;
    }
    if (!response.ok) throw new RemoteUploadFetchError("REMOTE_HTTP", "Remote upload returned HTTP " + response.status + ".");
    const maxBytes = input.maxBytes || MAX_IMAGE_ENCODED_BYTES;
    const length = Number(response.headers.get("content-length") || 0);
    if (Number.isFinite(length) && length > maxBytes) throw new RemoteUploadFetchError("REMOTE_CONTENT_LENGTH_TOO_LARGE", "Remote upload exceeds the encoded-file limit.", 413);
    return { bytes: await readLimitedRemoteBody(response.body, maxBytes), contentType: response.headers.get("content-type") || "", finalUrl: url.toString() };
  }
  throw new RemoteUploadFetchError("REMOTE_REDIRECT_LIMIT", "Remote upload exceeded the redirect limit.");
}

export function observedUploadHosts() { return [...configuredHosts()].sort(); }
