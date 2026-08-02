"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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
  product_type?: string | null;
  product_title?: string | null;
  variant_title?: string | null;
  financial_status?: string | null;
  pod_status?: string | null;
  image_count: number;
  generated_count: number;
  approved_count: number;
  generating_count: number;
  failed_count: number;
  uploaded_count: number;
};

type OrderTab =
  | "all"
  | "uploaded"
  | "generating"
  | "generated"
  | "approved"
  | "exported"
  | "fulfilled"
  | "failed";

type SortMode = "newest" | "oldest";

const ORDER_TABS: { key: OrderTab; label: string; description: string }[] = [
  {
    key: "all",
    label: "All Orders",
    description: "Every order in the system.",
  },
  {
    key: "uploaded",
    label: "Uploaded",
    description: "Photos imported, not generated yet.",
  },
  {
    key: "generating",
    label: "Generating",
    description: "AI generation currently in progress.",
  },
  {
    key: "generated",
    label: "Generated",
    description: "Generated pages waiting for review.",
  },
  {
    key: "approved",
    label: "Approved",
    description: "All pages approved, ready to export.",
  },
  {
    key: "exported",
    label: "Exported",
    description: "PDF exported, ready for fulfilment.",
  },
  {
    key: "fulfilled",
    label: "Fulfilled",
    description: "Order has been completed or sent to production.",
  },
  {
    key: "failed",
    label: "Failed",
    description: "Needs attention because something failed.",
  },
];

function normalize(value: string | null | undefined) {
  return (value || "").toLowerCase().trim();
}

function getProductLabel(order: Order) {
  const productType = normalize(order.product_type);
  const title = normalize(order.product_title);
  const variant = normalize(order.variant_title);
  const combined = `${productType} ${title} ${variant}`;

  if (
    productType === "story_book" ||
    combined.includes("story book") ||
    combined.includes("storybook") ||
    combined.includes("clip")
  ) {
    return "Story Book";
  }

  return "Colouring Book";
}

function getInitials(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);

  if (parts.length === 0) {
    return "MB";
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }

  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

function getOrderBucket(order: Order): OrderTab {
  const status = normalize(order.status);
  const pdfStatus = normalize(order.pdf_status);
  const podStatus = normalize(order.pod_status);

  if (
    order.failed_count > 0 ||
    status.includes("failed") ||
    status.includes("error") ||
    pdfStatus.includes("failed")
  ) {
    return "failed";
  }

  if (
    status === "fulfilled" ||
    status === "complete" ||
    status === "completed" ||
    podStatus === "fulfilled" ||
    podStatus === "submitted" ||
    podStatus === "complete" ||
    podStatus === "completed"
  ) {
    return "fulfilled";
  }

  if (order.pdf_url || pdfStatus === "exported" || status === "exported") {
    return "exported";
  }

  if (
    order.image_count > 0 &&
    order.generated_count > 0 &&
    order.approved_count === order.image_count &&
    order.generated_count === order.image_count
  ) {
    return "approved";
  }

  if (
    order.image_count > 0 &&
    order.generated_count === order.image_count &&
    order.approved_count < order.image_count
  ) {
    return "generated";
  }

  if (order.generating_count > 0 || status === "generating") {
    return "generating";
  }

  return "uploaded";
}

function getStatusBadge(order: Order) {
  const bucket = getOrderBucket(order);

  const styles: Record<OrderTab, string> = {
    all: "border-neutral-700 bg-neutral-900 text-neutral-300",
    uploaded: "border-neutral-700 bg-neutral-900 text-neutral-300",
    generating: "border-blue-900 bg-blue-950 text-blue-300",
    generated: "border-yellow-900 bg-yellow-950 text-yellow-300",
    approved: "border-green-900 bg-green-950 text-green-300",
    exported: "border-cyan-900 bg-cyan-950 text-cyan-300",
    fulfilled: "border-purple-900 bg-purple-950 text-purple-300",
    failed: "border-red-900 bg-red-950 text-red-300",
  };

  const labels: Record<OrderTab, string> = {
    all: "All",
    uploaded: "Uploaded",
    generating: "Generating",
    generated: "Generated",
    approved: "Approved",
    exported: "Exported",
    fulfilled: "Fulfilled",
    failed: "Failed",
  };

  if (bucket === "generated") {
    return {
      label: `${order.generated_count}/${order.image_count} generated`,
      className: styles[bucket],
    };
  }

  if (bucket === "approved") {
    return {
      label: `${order.approved_count}/${order.image_count} approved`,
      className: styles[bucket],
    };
  }

  if (bucket === "generating") {
    return {
      label: `Generating ${order.generating_count || ""}`.trim(),
      className: styles[bucket],
    };
  }

  if (bucket === "failed") {
    return {
      label: `${order.failed_count || 1} failed`,
      className: styles[bucket],
    };
  }

  return {
    label: labels[bucket],
    className: styles[bucket],
  };
}

function timeAgo(dateString: string) {
  const date = new Date(dateString);
  const diff = Date.now() - date.getTime();

  if (Number.isNaN(diff)) {
    return "unknown";
  }

  const minutes = Math.floor(diff / 60000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 7) return `${days}d ago`;

  return date.toLocaleDateString();
}

export default function Home() {
  const [customerName, setCustomerName] = useState("");
  const [customerEmail, setCustomerEmail] = useState("");
  const [pageCount, setPageCount] = useState("20");
  const [files, setFiles] = useState<File[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [activeTab, setActiveTab] = useState<OrderTab>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("newest");
  const [loading, setLoading] = useState(false);
  const [loadingOrders, setLoadingOrders] = useState(false);
  const [message, setMessage] = useState("");

  async function logout() {
    await fetch("/api/admin/logout", {
      method: "POST",
    });

    window.location.href = "/login";
  }

  async function loadOrders() {
    setLoadingOrders(true);

    try {
      const response = await fetch("/api/orders", {
        cache: "no-store",
      });

      const data = await response.json();

      if (!response.ok) {
        setMessage(data.error || "Failed to load orders.");
        return;
      }

      setOrders(data.orders || []);
    } catch {
      setMessage("Failed to load orders.");
    } finally {
      setLoadingOrders(false);
    }
  }

  useEffect(() => {
    loadOrders();

    const interval = setInterval(() => {
      loadOrders();
    }, 5000);

    return () => clearInterval(interval);
  }, []);

  const tabCounts = useMemo(() => {
    const counts = ORDER_TABS.reduce(
      (current, tab) => {
        current[tab.key] = 0;
        return current;
      },
      {} as Record<OrderTab, number>
    );

    counts.all = orders.length;

    for (const order of orders) {
      const bucket = getOrderBucket(order);
      counts[bucket] += 1;
    }

    return counts;
  }, [orders]);

  const visibleOrders = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();

    const filtered = orders.filter((order) => {
      const bucket = getOrderBucket(order);

      if (activeTab !== "all" && bucket !== activeTab) {
        return false;
      }

      if (!query) {
        return true;
      }

      const searchable = [
        order.customer_name,
        order.customer_email,
        getProductLabel(order),
        order.product_title || "",
        order.variant_title || "",
        order.status || "",
        order.pdf_status || "",
        order.financial_status || "",
      ]
        .join(" ")
        .toLowerCase();

      return searchable.includes(query);
    });

    return filtered.sort((a, b) => {
      const aTime = new Date(a.created_at).getTime();
      const bTime = new Date(b.created_at).getTime();

      return sortMode === "newest" ? bTime - aTime : aTime - bTime;
    });
  }, [orders, activeTab, searchQuery, sortMode]);

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
          setMessage(
            uploadData.error || "Order created, but image upload failed."
          );
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

  const activeDescription =
    ORDER_TABS.find((tab) => tab.key === activeTab)?.description ||
    "Manage orders.";

  return (
    <main className="min-h-screen bg-neutral-950 text-white">
      <div className="mx-auto max-w-7xl px-6 py-10">
        <div className="mb-10">
          <p className="text-sm uppercase tracking-[0.3em] text-neutral-400">
            Memory Books
          </p>

          <div className="mt-3 flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h1 className="text-4xl font-semibold">Production Dashboard</h1>
              <p className="mt-3 max-w-2xl text-neutral-400">
                Upload customer photos, generate pages, review results, approve
                orders, export PDFs, and track fulfilment.
              </p>
            </div>

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
                <option value="12">12</option>
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
                    {files.length} selected image
                    {files.length === 1 ? "" : "s"}
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

          {message && <p className="mt-4 text-sm text-neutral-300">{message}</p>}
        </section>

        <section className="mt-8 rounded-2xl border border-neutral-800 bg-neutral-900 p-6">
          <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <h2 className="text-2xl font-medium">Orders</h2>
              <p className="mt-2 text-neutral-400">
                {activeDescription}
              </p>
            </div>

            <p className="text-sm text-neutral-500">
              {loadingOrders ? "Refreshing..." : `${visibleOrders.length} visible`}
            </p>
          </div>

          <div className="mt-5 flex flex-wrap gap-2">
            {ORDER_TABS.map((tab) => {
              const isActive = activeTab === tab.key;

              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`rounded-xl border px-4 py-2 text-sm transition ${
                    isActive
                      ? "border-white bg-white text-black"
                      : "border-neutral-700 bg-neutral-950 text-neutral-300 hover:border-neutral-400 hover:text-white"
                  }`}
                >
                  <span>{tab.label}</span>
                  <span
                    className={`ml-2 rounded-full px-2 py-0.5 text-xs ${
                      isActive
                        ? "bg-black text-white"
                        : "bg-neutral-800 text-neutral-300"
                    }`}
                  >
                    {tabCounts[tab.key]}
                  </span>
                </button>
              );
            })}
          </div>

          <div className="mt-5 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search by customer, email, product, or status..."
              className="w-full rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-sm text-white outline-none placeholder:text-neutral-600 focus:border-white md:max-w-xl"
            />

            <select
              value={sortMode}
              onChange={(event) => setSortMode(event.target.value as SortMode)}
              className="rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-3 text-sm text-white outline-none focus:border-white"
            >
              <option value="newest">Sort: Newest first</option>
              <option value="oldest">Sort: Oldest first</option>
            </select>
          </div>

          <div className="mt-5 overflow-hidden rounded-xl border border-neutral-800 bg-neutral-950">
            {visibleOrders.length === 0 ? (
              <div className="p-5 text-neutral-500">
                No orders in this section.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[980px] border-collapse text-left text-sm">
                  <thead className="border-b border-neutral-800 bg-neutral-900 text-xs uppercase tracking-[0.12em] text-neutral-500">
                    <tr>
                      <th className="px-5 py-4 font-medium">Customer</th>
                      <th className="px-5 py-4 font-medium">Product</th>
                      <th className="px-5 py-4 font-medium">Pages</th>
                      <th className="px-5 py-4 font-medium">Status</th>
                      <th className="px-5 py-4 font-medium">Images</th>
                      <th className="px-5 py-4 font-medium">Generated</th>
                      <th className="px-5 py-4 font-medium">Approved</th>
                      <th className="px-5 py-4 font-medium">Created</th>
                      <th className="px-5 py-4 font-medium">Action</th>
                    </tr>
                  </thead>

                  <tbody className="divide-y divide-neutral-900">
                    {visibleOrders.map((order) => {
                      const badge = getStatusBadge(order);

                      return (
                        <tr
                          key={order.id}
                          className="transition hover:bg-neutral-900"
                        >
                          <td className="px-5 py-4">
                            <div className="flex items-center gap-3">
                              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-neutral-800 text-xs font-semibold text-white">
                                {getInitials(order.customer_name)}
                              </div>

                              <div className="min-w-0">
                                <p className="truncate font-medium text-neutral-100">
                                  {order.customer_name}
                                </p>
                                <p className="truncate text-xs text-neutral-500">
                                  {order.customer_email}
                                </p>
                              </div>
                            </div>
                          </td>

                          <td className="px-5 py-4 text-neutral-300">
                            {getProductLabel(order)}
                          </td>

                          <td className="px-5 py-4 text-neutral-300">
                            {order.page_count}
                          </td>

                          <td className="px-5 py-4">
                            <span
                              className={`inline-flex rounded-full border px-3 py-1 text-xs ${badge.className}`}
                            >
                              {badge.label}
                            </span>
                          </td>

                          <td className="px-5 py-4 text-neutral-300">
                            {order.image_count}
                          </td>

                          <td className="px-5 py-4 text-neutral-300">
                            {order.generated_count}
                          </td>

                          <td className="px-5 py-4 text-neutral-300">
                            {order.approved_count}
                          </td>

                          <td className="px-5 py-4 text-neutral-400">
                            {timeAgo(order.created_at)}
                          </td>

                          <td className="px-5 py-4">
                            <Link
                              href={`/orders/${order.id}`}
                              className="inline-flex rounded-xl border border-neutral-700 px-3 py-2 text-xs text-neutral-200 hover:border-white hover:text-white"
                            >
                              View Order
                            </Link>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
