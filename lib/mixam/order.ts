import { getMixamDeliveryAddress } from "./delivery";

export function mixamAddress(order: Record<string, unknown>) {
  return getMixamDeliveryAddress(order);
}

export function safeMixamError(error: unknown) {
  const message = error instanceof Error ? error.message : "Mixam operation failed.";
  return message.replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]").slice(0, 1000);
}
