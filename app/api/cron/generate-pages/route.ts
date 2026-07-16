import { NextResponse } from "next/server";
import { supabaseAdmin } from "../../../../lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const MAX_ORDERS_PER_CRON = 2;

export async function GET(request: Request) {
  try {
    const origin = new URL(request.url).origin;

    const { data: candidateOrders, error: orderError } = await supabaseAdmin
      .from("orders")
      .select("id, status, created_at")
      .in("status", ["uploaded", "generating", "generation_failed"])
      .order("created_at", { ascending: true })
      .limit(20);

    if (orderError) {
      return NextResponse.json({ error: orderError.message }, { status: 500 });
    }

    const processed = [];

    for (const order of candidateOrders || []) {
      if (processed.length >= MAX_ORDERS_PER_CRON) break;

      const { count: remainingCount, error: countError } = await supabaseAdmin
        .from("order_images")
        .select("id", { count: "exact", head: true })
        .eq("order_id", order.id)
        .or("generated_url.is.null,status.eq.failed,status.eq.uploaded,status.eq.not_generated");

      if (countError || !remainingCount) continue;

      const response = await fetch(`${origin}/api/orders/${order.id}/generate`, {
        method: "POST",
      });

      let result: unknown = null;

      try {
        result = await response.json();
      } catch {
        result = null;
      }

      processed.push({
        order_id: order.id,
        status: response.status,
        result,
      });
    }

    return NextResponse.json({
      ok: true,
      processed,
      message:
        processed.length > 0
          ? "Generation batch processed."
          : "No pending generation work found.",
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Cron generation failed.";

    console.error("Generation cron failed:", message);

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
