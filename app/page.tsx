"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type Order = {
  id: string;
  customer_name: string;
  customer_email: string;
  page_count: number;
  status: string;
  created_at: string;
  pdf_url: string | null;
  pdf_status: string | null;
  exported_at: string | null;
  image_count: number;
  generated_count: number;
  approved_count: number;
  generating_count: number;
  failed_count: number;
  uploaded_count: number;
};

function getProductionStatus(order: Order) {
  if (order.pdf_url) {
    return {
      label: "PDF exported",
      className: "bg-purple-950 text-purple-300",
    };
  }

  if (!order.image_count || order.image_count === 0) {
    return {
      label: "No images uploaded",
      className: "bg-neutral-800 text-neutral-300",
    };
  }

  if (order.failed_count > 0) {
    return {
      label: `${order.generated_count}/${order.image_count} generated · ${order.failed_count} failed`,
      className: "bg-red-950 text-red-300",
    };
  }

  if (order.generating_count > 0) {
    return {
      label: `Generating ${order.generating_count}/${order.image_count}`,
      className: "bg-blue-950 text-blue-300",
    };
  }

  if (order.approved_count > 0 && order.approved_count === order.generated_count) {
    return {
      label: `${order.approved_count}/${order.image_count} approved`,
      className: "bg-green-950 text-green-300",
    };
  }

  if (order.generated_count === order.image_count) {
    return {
      label: `${order.generated_count}/${order.image_count} generated · needs review`,
      className: "bg-yellow-950 text-yellow-300",
    };
  }

  if (order.generated_count > 0) {
    return {
      label: `${order.generated_count}/${order.image_count} generated`,
      className: "bg-yellow-950 text-yellow-300",
    };
  }

  return {
    label: `${order.image_count} photos · not generated`,
    className: "bg-neutral-800 text-neutral-300",
  };
}

export default function Home() {
  async function logout() {
    await fetch("/api/admin/logout", {
      method: "POST",
    });

    window.location.href = "/login";
  }

  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [pageCount, setPageCount] = useState("20");
  const [files, setFiles] = useState<File[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function loadOrders() {
    try {
      const response = await fetch("/api/orders");
      const data = await response.json();

      if (data.orders) {
        setOrders(data.orders);
      }
    } catch {
      console.error("Failed to load orders.");
    }
  }

  useEffect(() => {
    loadOrders();

    const interval = setInterval(() => {
      loadOrders();
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  function addSelectedFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) {
      return;
    }

    const newFiles = Array.from(fileList);

    setFiles((currentFiles) => {
      const existingKeys = new Set(
        currentFiles.map(
          (file) => `${file.name}-${file.size}-${file.lastModified}`
        )
      );

      const uniqueNewFiles = newFiles.filter((file) => {
        const key = `${file.name}-${file.size}-${file.lastModified}`;
        return !existingKeys.has(key);
      });

      return [...currentFiles, ...uniqueNewFiles];
    });

    const fileInput = document.getElementById(
      "customer-photos"
    ) as HTMLInputElement | null;

    if (fileInput) {
      fileInput.value = "";
    }
  }

  function removeSelectedFile(indexToRemove: number) {
    setFiles((currentFiles) =>
      currentFiles.filter((_, index) => index !== indexToRemove)
    );
  }

  function clearSelectedFiles() {
    setFiles([]);

    const fileInput = document.getElementById(
      "customer-photos"
    ) as HTMLInputElement | null;

    if (fileInput) {
      fileInput.value = "";
    }
  }

  async function createTestOrder() {
    setLoading(true);
    setMessage("");

    try {
      const orderResponse = await fetch("/api/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          customer_name: customerName,
          customer_email: customerEmail,
          page_count: Number(pageCount),
        }),
      });

      const orderData = await orderResponse.json();

      if (!orderResponse.ok) {
        setMessage(orderData.error || "Something went wrong creating order.");
        return;
      }

      const orderId = orderData.order.id;

      if (files.length > 0) {
        const formData = new FormData();
        formData.append("order_id", orderId);

        files.forEach((file) => {
          formData.append("files", file);
        });

        const uploadResponse = await fetch("/api/orders/upload", {
          method: "POST",
          body: formData,
        });

        const uploadData = await uploadResponse.json();

        if (!uploadResponse.ok) {
          setMessage(uploadData.error || "Order created, but image upload failed.");
          await loadOrders();
          return;
        }

        setMessage(
          `Test order created with ${uploadData.images.length} uploaded image(s).`
        );
      } else {
        setMessage("Test order created without images.");
      }

      setCustomerName("");
      setCustomerEmail("");
      setPageCount("20");
      clearSelectedFiles();

      await loadOrders();
    } catch {
      setMessage("Failed to create test order.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-white">
      <div className="mx-auto max-w-6xl px-6 py-10">
        <div className="mb-10">
          <p className="text-sm uppercase tracking-[0.3em] text-neutral-400">
            Memory Books
          </p>
          <h1 className="mt-3 text-4xl font-semibold">
            Production Dashboard
          </h1>
          <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <p className="max-w-2xl text-neutral-400">
              Upload customer photos, generate colouring-book pages, review the
              results, approve pages, and export print-ready PDFs.
            </p>

            <button
              onClick={logout}
              className="w-fit rounded-xl border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:border-white hover:text-white"
            >
              Logout
            </button>
          </div>
        </div>

        <section className="rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
          <h2 className="text-2xl font-medium">Create Test Order</h2>
          <p className="mt-2 text-neutral-400">
            This test form creates an order and uploads customer photos to
            Supabase storage.
          </p>

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-2 block text-sm text-neutral-300">
                Customer name
              </label>
              <input
                value={customerName}
                onChange={(event) => setCustomerName(event.target.value)}
                className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-white outline-none focus:border-white"
                placeholder="Sarah Johnson"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-neutral-300">
                Customer email
              </label>
              <input
                value={customerEmail}
                onChange={(event) => setCustomerEmail(event.target.value)}
                className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-white outline-none focus:border-white"
                placeholder="sarah@email.com"
              />
            </div>

            <div>
              <label className="mb-2 block text-sm text-neutral-300">
                Page count
              </label>
              <select
                value={pageCount}
                onChange={(event) => setPageCount(event.target.value)}
                className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-white outline-none focus:border-white"
              >
                <option value="10">10</option>
                <option value="20">20</option>
                <option value="30">30</option>
                <option value="40">40</option>
              </select>
            </div>

            <div>
              <label className="mb-2 block text-sm text-neutral-300">
                Customer photos
              </label>
              <input
                id="customer-photos"
                type="file"
                multiple
                accept="image/*,.heic,.heif,.avif,.bmp,.dib,.gif,.jpg,.jpeg,.jfif,.pjpeg,.pjp,.png,.tif,.tiff,.webp"
                onChange={(event) => addSelectedFiles(event.target.files)}
                className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-white outline-none file:mr-4 file:rounded-lg file:border-0 file:bg-white file:px-4 file:py-2 file:text-sm file:text-black"
              />

              <div className="mt-2 flex items-center justify-between gap-3">
                <p className="text-xs text-neutral-500">
                  Supports JPG, PNG, WebP, HEIC, HEIF, AVIF, GIF, BMP, and TIFF.
                </p>

                {files.length > 0 && (
                  <button
                    type="button"
                    onClick={clearSelectedFiles}
                    className="text-xs text-neutral-400 hover:text-white"
                  >
                    Clear all
                  </button>
                )}
              </div>

              {files.length > 0 && (
                <div className="mt-3 rounded-xl border border-neutral-800 bg-neutral-950 p-3">
                  <p className="mb-2 text-sm text-neutral-300">
                    {files.length} selected image{files.length === 1 ? "" : "s"}
                  </p>

                  <div className="space-y-2">
                    {files.map((file, index) => (
                      <div
                        key={`${file.name}-${file.size}-${file.lastModified}-${index}`}
                        className="flex items-center justify-between gap-3 rounded-lg bg-neutral-900 px-3 py-2"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm text-neutral-200">
                            {file.name}
                          </p>
                          <p className="text-xs text-neutral-500">
                            {(file.size / 1024 / 1024).toFixed(2)} MB
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => removeSelectedFile(index)}
                          className="shrink-0 rounded-lg border border-neutral-700 px-2 py-1 text-xs text-neutral-300 hover:border-white hover:text-white"
                        >
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          <button
            onClick={createTestOrder}
            disabled={loading}
            className="mt-6 rounded-xl bg-white px-5 py-3 font-medium text-black hover:bg-neutral-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Creating..." : "Create Test Order"}
          </button>

          {message && (
            <p className="mt-4 text-sm text-neutral-300">
              {message}
            </p>
          )}
        </section>

        <section className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
          <h2 className="text-2xl font-medium">Recent Orders</h2>
          <p className="mt-2 text-neutral-400">
            Click an order to review, approve, regenerate, and export.
          </p>

          <div className="mt-6 space-y-3">
            {orders.length === 0 ? (
              <div className="rounded-xl border border-neutral-800 bg-neutral-950 p-5 text-neutral-500">
                No orders yet.
              </div>
            ) : (
              orders.map((order) => {
                const productionStatus = getProductionStatus(order);

                return (
                  <Link
                    href={`/orders/${order.id}`}
                    key={order.id}
                    className="block rounded-xl border border-neutral-800 bg-neutral-950 p-5 transition hover:border-neutral-600 hover:bg-neutral-900"
                  >
                    <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
                      <div>
                        <p className="font-medium">{order.customer_name}</p>
                        <p className="text-sm text-neutral-400">
                          {order.customer_email}
                        </p>
                      </div>

                      <div className="flex flex-col gap-2 text-sm text-neutral-400 md:items-end">
                        <p>
                          {order.page_count} pages · {order.status}
                        </p>

                        <span
                          className={`rounded-full px-3 py-1 text-xs ${productionStatus.className}`}
                        >
                          {productionStatus.label}
                        </span>
                      </div>
                    </div>
                  </Link>
                );
              })
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
