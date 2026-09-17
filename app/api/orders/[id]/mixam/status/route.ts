import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(_: Request, context: { params: Promise<{ id: string }> }) {
  const { id: orderId } = await context.params;
  const { data, error } = await supabaseAdmin.from("supplier_fulfillments").select("*, supplier_product_configurations(*)").eq("order_id", orderId).eq("supplier", "mixam").maybeSingle();
  if (error) return NextResponse.json({ ok: false, stage: "MIXAM_STATUS", message: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, fulfillment: data || null });
}
