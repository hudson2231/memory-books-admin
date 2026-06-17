import { NextResponse } from "next/server";
import crypto from "crypto";

function createAdminToken(password: string) {
  return crypto
    .createHash("sha256")
    .update(`memory-books-admin:${password}`)
    .digest("hex");
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const password = String(body.password || "");
    const adminPassword = process.env.ADMIN_PASSWORD || "";

    if (!adminPassword) {
      return NextResponse.json(
        { error: "ADMIN_PASSWORD is not configured." },
        { status: 500 }
      );
    }

    if (password !== adminPassword) {
      return NextResponse.json(
        { error: "Incorrect password." },
        { status: 401 }
      );
    }

    const token = createAdminToken(adminPassword);

    const response = NextResponse.json({ ok: true });

    response.cookies.set("memory_books_admin", token, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });

    return response;
  } catch {
    return NextResponse.json(
      { error: "Invalid login request." },
      { status: 400 }
    );
  }
}
