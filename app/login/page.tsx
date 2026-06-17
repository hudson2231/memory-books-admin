"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

function LoginForm() {
  const searchParams = useSearchParams();
  const nextPath = searchParams.get("next") || "/";

  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function login() {
    setLoading(true);
    setMessage("");

    try {
      const response = await fetch("/api/admin/login", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ password }),
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error || "Login failed.");
        return;
      }

      window.location.href = nextPath;
    } catch {
      setMessage("Login failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
      <p className="text-sm uppercase tracking-[0.3em] text-neutral-500">
        Memory Books
      </p>

      <h1 className="mt-3 text-3xl font-semibold">
        Admin Login
      </h1>

      <p className="mt-2 text-neutral-400">
        Enter your admin password to access the production dashboard.
      </p>

      <div className="mt-6">
        <label className="mb-2 block text-sm text-neutral-300">
          Password
        </label>

        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              login();
            }
          }}
          className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-white outline-none focus:border-white"
          placeholder="Admin password"
        />
      </div>

      <button
        onClick={login}
        disabled={loading}
        className="mt-6 w-full rounded-xl bg-white px-5 py-3 font-medium text-black hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? "Logging in..." : "Login"}
      </button>

      {message && (
        <p className="mt-4 text-sm text-red-400">
          {message}
        </p>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-neutral-950 px-6 text-white">
      <Suspense
        fallback={
          <div className="w-full max-w-md rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
            <p className="text-neutral-400">Loading login...</p>
          </div>
        }
      >
        <LoginForm />
      </Suspense>
    </main>
  );
}
