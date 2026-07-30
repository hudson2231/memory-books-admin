import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const apiKey = process.env.ELEVENLABS_API_KEY;

  if (!apiKey) {
    return NextResponse.json(
      { ok: false, error: "Missing ELEVENLABS_API_KEY" },
      { status: 500 }
    );
  }

  try {
    const res = await fetch("https://api.elevenlabs.io/v1/models", {
      method: "GET",
      headers: {
        "xi-api-key": apiKey,
      },
    });

    const text = await res.text();

    return NextResponse.json({
      ok: res.ok,
      status: res.status,
      preview: text.slice(0, 1000),
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        ok: false,
        error: err?.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}
