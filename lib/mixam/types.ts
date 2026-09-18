export type MixamProductOption = {
  productId: number;
  subProductId: number;
  title?: string;
  imageUrl?: string;
};

export type MixamProduct = {
  id: number;
  title?: string;
  menuLabel?: string;
  description?: string;
  quoteType?: string;
  options?: MixamProductOption[];
};

export type MixamSubstrate = {
  typeId: number;
  weightId: number;
  colourId?: number;
  design?: string;
};

export type MixamComponent = {
  componentType: "BOUND" | "COVER" | "END_PAPER" | string;
  format?: number;
  standardSize?: string;
  orientation?: string;
  colours?: string;
  substrate?: MixamSubstrate;
  pages?: number;
  binding?: Record<string, unknown>;
  lamination?: string;
  backColours?: string;
  backLamination?: string;
  coverArea?: string;
  [key: string]: unknown;
};

export type MixamItemSpecification = {
  copies: number;
  product: string;
  components: MixamComponent[];
  [key: string]: unknown;
};

export type MixamProductMetadata = {
  productId: number;
  subProductId: number;
  productName?: string;
  boundMetadata?: {
    pagesIncrement?: number;
    defaultPages?: number;
    pagesPerLeaf?: number;
    bindingTypeOptions?: Array<Record<string, unknown>>;
    bindingEdgeOptions?: Array<Record<string, unknown>>;
  };
  laminationMetadata?: { coverOptions?: Array<Record<string, unknown>> };
  copiesMetadata?: { minimumValue?: number; stepValue?: number };
  standardSizes?: Array<Record<string, unknown>>;
  coloursMetadata?: {
    coloursOptions?: Array<Record<string, unknown>>;
    outerCoverColoursOptions?: Array<Record<string, unknown>>;
    innerCoverColoursOptions?: Array<Record<string, unknown>>;
  };
  substrateTypes?: Array<Record<string, unknown>>;
  substrateWeights?: Record<string, unknown>;
  initialSpecification?: MixamItemSpecification;
  [key: string]: unknown;
};

export type MixamOffer = {
  offerId?: string;
  price?: number;
  productionDays?: number;
  countryOfOrigin?: string;
  currencyCode?: string;
  includeShipment?: boolean;
  [key: string]: unknown;
};

export type MixamOfferResponse = {
  universalKey?: string;
  offers?: MixamOffer[];
  printOnDemandAvailable?: boolean;
  spine?: number;
  turnaroundMin?: number;
  turnaroundMax?: number;
  packagingCost?: number;
  vat?: Record<string, unknown>;
  [key: string]: unknown;
};

export type MixamDeliveryRate = {
  serviceId: string;
  courier?: string;
  courierCode?: string;
  service?: string;
  serviceCode?: string;
  cost: number;
  daysInTransit?: number;
  /** Retained only if an account response supplies it; not required by the published schema. */
  currency?: string;
  currencyCode?: string;
};

export type MixamDeliveryRatesResponse = {
  weight?: number;
  dispatchDate?: string;
  includeShipment?: boolean;
  deliveryRates: MixamDeliveryRate[];
};

export type MixamDeliveryGroup = {
  id: string;
  serviceId?: string;
  courier?: string;
  courierCode?: string;
  service?: string;
  serviceCode?: string;
  cost?: number;
  dispatchDate?: string;
  deliveryDate?: string;
  includeShipment?: boolean;
};

export type MixamOrderDelivery = {
  id: string;
  deliveryGroups?: MixamDeliveryGroup[];
};

export type MixamOrder = {
  id: string;
  orderStatus?: string;
  deliveries?: MixamOrderDelivery[];
  shipments?: Array<Record<string, unknown>>;
  orderItems?: Array<Record<string, unknown>>;
};

export type MixamSavedConfiguration = {
  key: "story_20" | "story_32" | "story_40" | "colouring_20" | "colouring_32" | "colouring_40";
  productId: number;
  subProductId: number;
  quoteType: string;
  itemSpecification: MixamItemSpecification;
  universalKey: string;
  offerId?: string;
  pageCount: number;
  resolvedAt: string;
  supplierMetadata: MixamOfferResponse;
};
