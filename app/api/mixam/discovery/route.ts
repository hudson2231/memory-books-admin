import { NextResponse } from "next/server";
import { getMixamCatalogue, getMixamProductMetadata, getMixamProducts } from "../../../../lib/mixam/client";
import { inspectMixamMetadata, MIXAM_TARGETS } from "../../../../lib/mixam/resolver";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

/** Admin-protected by middleware. Discovery-only: no order, quote, upload, or DB write. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const productId = Number(searchParams.get("productId"));
  const subProductId = Number(searchParams.get("subProductId"));
  const targetKey = searchParams.get("target");
  try {
    if (productId && subProductId) {
      const metadata = await getMixamProductMetadata(productId, subProductId);
      const target = targetKey && targetKey in MIXAM_TARGETS ? MIXAM_TARGETS[targetKey as keyof typeof MIXAM_TARGETS] : null;
      return NextResponse.json({ ok: true, metadata, resolution: target ? inspectMixamMetadata(target, metadata) : null });
    }
    const [products, catalogue] = await Promise.all([getMixamProducts(), getMixamCatalogue()]);
    return NextResponse.json({ ok: true, products, catalogue });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Mixam discovery failed.";
    return NextResponse.json({ ok: false, stage: "MIXAM_DISCOVERY", error: message }, { status: 500 });
  }
}
