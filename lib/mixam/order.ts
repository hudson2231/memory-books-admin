import { getShippingAddress } from "../gelato";

export function mixamAddress(order: Record<string, unknown>) {
  const address = getShippingAddress(order);
  return {
    company: address.companyName || "",
    firstName: address.firstName,
    lastName: address.lastName,
    postcode: address.postCode,
    line1: address.addressLine1,
    line2: address.addressLine2 || "",
    line3: "",
    town: address.city,
    county: address.state || "",
    country: address.country,
    phoneNumber: address.phone || "",
    emailAddress: address.email || "",
  };
}

export function safeMixamError(error: unknown) {
  const message = error instanceof Error ? error.message : "Mixam operation failed.";
  return message.replace(/Bearer\s+[A-Za-z0-9._-]+/g, "Bearer [redacted]").slice(0, 1000);
}
