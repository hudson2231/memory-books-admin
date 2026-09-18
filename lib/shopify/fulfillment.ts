export type ShopifyTrackingInfo = { number: string; company?: string; url?: string };
export type ShopifyFulfillmentLine = { fulfillmentOrderId: string; fulfillmentOrderLineItemId: string; quantity: number };

export const SHOPIFY_FULFILLMENT_ORDERS_QUERY = `
  query MemoryBooksFulfillmentOrders($orderId: ID!) {
    order(id: $orderId) {
      fulfillmentOrders(first: 50) {
        nodes {
          id
          status
          lineItems(first: 50) {
            nodes {
              id
              remainingQuantity
            }
          }
        }
      }
    }
  }
`;

export const SHOPIFY_CREATE_FULFILLMENT_MUTATION = `
  mutation MemoryBooksCreateFulfillment($fulfillment: FulfillmentInput!) {
    fulfillmentCreate(fulfillment: $fulfillment) {
      fulfillment {
        id
        status
        trackingInfo {
          company
          number
          url
        }
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export function shopifyOrderGid(shopifyOrderId: string | number) {
  return `gid://shopify/Order/${String(shopifyOrderId)}`;
}

/** Builds GraphQL variables only; this module intentionally has no network mutation. */
export function buildShopifyFulfillmentVariables(input: { lines: ShopifyFulfillmentLine[]; tracking: ShopifyTrackingInfo; notifyCustomer: boolean }) {
  if (!input.lines.length) throw new Error("SHOPIFY_FULFILLMENT: at least one fulfillment-order line is required.");
  if (!input.tracking.number.trim()) throw new Error("SHOPIFY_FULFILLMENT: tracking number is required.");
  const grouped = new Map<string, Array<{ id: string; quantity: number }>>();
  for (const line of input.lines) {
    if (!line.fulfillmentOrderId || !line.fulfillmentOrderLineItemId || !Number.isInteger(line.quantity) || line.quantity < 1) {
      throw new Error("SHOPIFY_FULFILLMENT: fulfillment order line data is invalid.");
    }
    const existing = grouped.get(line.fulfillmentOrderId) || [];
    existing.push({ id: line.fulfillmentOrderLineItemId, quantity: line.quantity });
    grouped.set(line.fulfillmentOrderId, existing);
  }
  return {
    fulfillment: {
      notifyCustomer: input.notifyCustomer,
      trackingInfo: input.tracking,
      lineItemsByFulfillmentOrder: Array.from(grouped, ([fulfillmentOrderId, fulfillmentOrderLineItems]) => ({ fulfillmentOrderId, fulfillmentOrderLineItems })),
    },
  };
}
