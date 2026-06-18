import { NextRequest, NextResponse } from "next/server";

async function sha256(value: string) {
  const data = new TextEncoder().encode(value);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hashBuffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;

  const publicPaths = [
    "/login",
    "/api/admin/login",
    "/api/shopify/order-paid",
    "/api/customer-upload",
  ];

  const isPublicPath = publicPaths.some((publicPath) =>
    path.startsWith(publicPath)
  );

  const isNextAsset =
    path.startsWith("/_next") ||
    path.startsWith("/favicon") ||
    path.includes(".");

  if (isPublicPath || isNextAsset) {
    return NextResponse.next();
  }

  const adminPassword = process.env.ADMIN_PASSWORD || "";
  const expectedToken = await sha256(`memory-books-admin:${adminPassword}`);
  const actualToken = request.cookies.get("memory_books_admin")?.value;

  if (!adminPassword || actualToken !== expectedToken) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", path);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
