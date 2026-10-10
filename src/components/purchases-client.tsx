"use client";

import { useCallback, useRef, useState } from "react";

type PurchaseItem = {
  id?: string;
  sparePartId: string;
  lineNumber?: number;
  code?: string;
  name?: string;
  quantity: string;
  unitBuyPrice?: string;
  lineAmount?: string;
};
type Purchase = {
  id: string;
  purchaseNumber: string;
  transactionAt: string;
  transactionInput?: string;
  transactionDisplay: string;
  supplierName: string;
  status: "DRAFT" | "COMPLETED" | "CANCELED";
  totalAmount?: string;
  editCount?: number;
  items: PurchaseItem[];
};
type Part = {
  id: string;
  code: string;
  name: string;
  sellingPrice?: string;
  latestBuyPrice?: string | null;
  averageCost?: string | null;
  currentStock: string;
  minimumStock?: string;
  isActive?: boolean;
};
const money = (value: string) => `Rp${BigInt(value).toLocaleString("id-ID")}`;
function csrfToken() {
  return (
    document.cookie
      .split(";")
      .map((item) => item.trim())
      .find((item) => item.startsWith("pb_csrf="))
      ?.slice(8) ?? ""
  );
}

async function mutate(
  url: string,
  method: string,
  body?: unknown,
  key = crypto.randomUUID(),
) {
  const response = await fetch(url, {
    method,
    headers: {
      "content-type": "application/json",
      "x-csrf-token": csrfToken(),
      "idempotency-key": key,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? "Permintaan gagal.");
  return result;
}

export function PurchasesClient({
  role,
  initialPurchases,
  spareparts,
  defaultDateTime,
  defaultPurchaseDate,
}: {
  role: "ADMIN" | "USER";
  initialPurchases: Purchase[];
  spareparts: Part[];
  defaultDateTime: string;
  defaultPurchaseDate: string;
}) {
  const activeSpareparts = spareparts.filter((part) => part.isActive === true);
  const [purchases, setPurchases] = useState(initialPurchases);
  const [purchaseDate, setPurchaseDate] = useState(defaultPurchaseDate);
  const [dateTime, setDateTime] = useState(defaultDateTime);
  const [supplier, setSupplier] = useState("");
  const [items, setItems] = useState<PurchaseItem[]>([
    {
      sparePartId: activeSpareparts[0]?.id ?? "",
      quantity: "1",
      unitBuyPrice: "",
    },
  ]);
  const [partSearch, setPartSearch] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingMode, setEditingMode] = useState<"DRAFT" | "COMPLETED" | null>(
    null,
  );
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const saveKey = useRef<string | null>(null);
  const admin = role === "ADMIN";
  const searchTerm = partSearch.trim().toLocaleLowerCase("id-ID");
  const matchesSearch = (part: Part) =>
    !searchTerm ||
    part.code.toLocaleLowerCase("id-ID").includes(searchTerm) ||
    part.name.toLocaleLowerCase("id-ID").includes(searchTerm);
  const optionsFor = (selectedId: string, rowIndex: number) =>
    activeSpareparts.filter(
      (part) =>
        part.id === selectedId ||
        (!items.some(
          (other, otherIndex) =>
            otherIndex !== rowIndex && other.sparePartId === part.id,
        ) &&
          matchesSearch(part)),
    );

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/purchases?date=${encodeURIComponent(purchaseDate)}`, { cache: "no-store" });
    if (response.ok) setPurchases((await response.json()).purchases);
    else setNotice("Daftar Purchase tidak dapat dimuat ulang.");
  }, [purchaseDate]);

  const resetForm = () => {
    setEditingId(null);
    setEditingMode(null);
    setReason("");
    setDateTime(defaultDateTime);
    setSupplier("");
    setItems([
      {
        sparePartId: activeSpareparts[0]?.id ?? "",
        quantity: "1",
        unitBuyPrice: "",
      },
    ]);
    setPartSearch("");
    saveKey.current = null;
  };

  const saveDraft = async () => {
    saveKey.current ??= crypto.randomUUID();
    setSaving(true);
    try {
      const payload = {
        transactionAt: dateTime,
        supplierName: supplier,
        items: items.map(({ sparePartId, quantity, unitBuyPrice }) => ({
          sparePartId,
          quantity,
          unitBuyPrice,
        })),
      };
      const url = editingId
        ? editingMode === "COMPLETED"
          ? `/api/admin/purchases/${editingId}/edit`
          : `/api/admin/purchases/${editingId}`
        : "/api/admin/purchases";
      await mutate(
        url,
        editingId ? "PATCH" : "POST",
        editingMode === "COMPLETED" ? { ...payload, reason } : payload,
        saveKey.current,
      );
      saveKey.current = null;
      setNotice(
        editingId
          ? editingMode === "COMPLETED"
            ? "Purchase Completed diperbarui dan koreksi stok tercatat."
            : "Draft Purchase diperbarui."
          : "Draft Purchase dibuat. Stok belum berubah.",
      );
      resetForm();
      await refresh();
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const editDraft = (purchase: Purchase) => {
    setEditingId(purchase.id);
    setEditingMode("DRAFT");
    setDateTime(purchase.transactionInput ?? defaultDateTime);
    setSupplier(purchase.supplierName);
    setItems(
      purchase.items.map((item) => ({
        sparePartId: item.sparePartId,
        quantity: item.quantity,
        unitBuyPrice: item.unitBuyPrice,
      })),
    );
  };

  const editCompleted = (purchase: Purchase) => {
    setEditingId(purchase.id);
    setEditingMode("COMPLETED");
    setDateTime(purchase.transactionInput ?? defaultDateTime);
    setSupplier(purchase.supplierName);
    setItems(
      purchase.items.map((item) => ({
        sparePartId: item.sparePartId,
        quantity: item.quantity,
        unitBuyPrice: item.unitBuyPrice,
      })),
    );
    setReason("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const confirmDraft = async (purchase: Purchase) => {
    setSaving(true);
    try {
      await mutate(`/api/admin/purchases/${purchase.id}/confirm`, "POST");
      setNotice(
        "Purchase dikonfirmasi. Stok dan Average Cost sudah diperbarui.",
      );
      await refresh();
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const deleteDraft = async (purchase: Purchase) => {
    if (
      !window.confirm(
        `Hapus Draft ${purchase.purchaseNumber}? Draft tidak memiliki dampak stok.`,
      )
    )
      return;
    setSaving(true);
    try {
      await mutate(`/api/admin/purchases/${purchase.id}`, "DELETE");
      setNotice("Draft Purchase dihapus.");
      if (editingId === purchase.id) resetForm();
      await refresh();
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const cancelCompleted = async (purchase: Purchase) => {
    if (
      !window.confirm(
        `Batalkan Purchase ${purchase.purchaseNumber}? Pembatalan ditolak bila ada pengeluaran stok untuk sparepart terkait sejak Purchase dikonfirmasi.`,
      )
    )
      return;
    setSaving(true);
    try {
      await mutate(`/api/admin/purchases/${purchase.id}/cancel`, "POST");
      setNotice("Purchase dibatalkan. Reversal stok tercatat.");
      await refresh();
    } catch (error) {
      setNotice((error as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <main className="mx-auto max-w-6xl p-6">
      <h1 className="text-2xl font-semibold">Purchase</h1>
      <p className="mt-2 text-sm text-slate-600">
        Draft tidak memengaruhi stok. Stok dan Average Cost berubah setelah
        Admin mengonfirmasi Purchase.
      </p>
      {notice && (
        <p role="status" className="my-3 rounded bg-slate-100 p-3">
          {notice}
        </p>
      )}
      {admin && (
        <section className="my-5 rounded border bg-white p-4">
          <h2 className="font-semibold">
            {editingId
              ? editingMode === "COMPLETED"
                ? "Ubah Purchase Completed"
                : "Ubah Draft"
              : "Buat Draft"}
          </h2>
          {editingMode === "COMPLETED" && (
            <p className="text-sm text-amber-800">
              Edit tersedia satu kali. Alasan wajib kecuali hanya supplier yang
              berubah.
            </p>
          )}
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            <label className="grid gap-1 text-sm">
              Tanggal dan waktu
              <input
                className="rounded border px-3 py-2"
                type="datetime-local"
                value={dateTime}
                onChange={(e) => setDateTime(e.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm">
              Supplier
              <input
                className="rounded border px-3 py-2"
                value={supplier}
                onChange={(e) => setSupplier(e.target.value)}
              />
            </label>
          </div>
          {editingMode === "COMPLETED" && (
            <label className="mt-3 grid gap-1 text-sm">
              Alasan perubahan (wajib kecuali supplier saja)
              <textarea
                className="rounded border px-3 py-2"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={1000}
              />{" "}
            </label>
          )}
          <div className="mt-4 space-y-3">
            <label className="grid gap-1 text-sm">
              Cari sparepart
              <input
                className="rounded border px-3 py-2"
                placeholder="Cari berdasarkan kode atau nama"
                value={partSearch}
                onChange={(e) => setPartSearch(e.target.value)}
              />
            </label>
            {searchTerm && !activeSpareparts.some(matchesSearch) && (
              <p className="text-sm text-slate-600">
                Tidak ada sparepart yang cocok dengan pencarian.
              </p>
            )}
            {items.map((item, index) => (
              <div
                key={index}
                className="grid gap-2 rounded border p-3 md:grid-cols-[2fr_1fr_1fr_auto]"
              >
                <label className="grid gap-1 text-sm">
                  Sparepart
                  <select
                    className="rounded border px-2 py-2"
                    value={item.sparePartId}
                    onChange={(e) =>
                      setItems((old) =>
                        old.map((row, rowIndex) =>
                          rowIndex === index
                            ? { ...row, sparePartId: e.target.value }
                            : row,
                        ),
                      )
                    }
                  >
                    <option value="">Pilih sparepart</option>
                    {optionsFor(item.sparePartId, index).map((part) => (
                      <option key={part.id} value={part.id}>
                        {part.code} — {part.name}
                      </option>
                    ))}
                  </select>
                  {activeSpareparts.find(
                    (part) => part.id === item.sparePartId,
                  ) && (
                    <span className="text-xs text-slate-600">
                      Harga beli terakhir:{" "}
                      {activeSpareparts.find(
                        (part) => part.id === item.sparePartId,
                      )?.latestBuyPrice
                        ? money(
                            activeSpareparts.find(
                              (part) => part.id === item.sparePartId,
                            )!.latestBuyPrice!,
                          )
                        : "—"}
                    </span>
                  )}
                </label>
                <label className="grid gap-1 text-sm">
                  Jumlah (pcs)
                  <input
                    className="rounded border px-2 py-2"
                    inputMode="numeric"
                    value={item.quantity}
                    onChange={(e) =>
                      setItems((old) =>
                        old.map((row, rowIndex) =>
                          rowIndex === index
                            ? { ...row, quantity: e.target.value }
                            : row,
                        ),
                      )
                    }
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  Harga beli per barang (Rp)
                  <input
                    className="rounded border px-2 py-2"
                    inputMode="numeric"
                    value={item.unitBuyPrice}
                    onChange={(e) =>
                      setItems((old) =>
                        old.map((row, rowIndex) =>
                          rowIndex === index
                            ? { ...row, unitBuyPrice: e.target.value }
                            : row,
                        ),
                      )
                    }
                  />
                </label>
                <button
                  disabled={editingMode !== "COMPLETED" && items.length <= 1}
                  className="self-end rounded border px-3 py-2 disabled:opacity-50"
                  onClick={() =>
                    setItems((old) =>
                      old.filter((_, rowIndex) => rowIndex !== index),
                    )
                  }
                >
                  Hapus item
                </button>
              </div>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="rounded border px-3 py-2"
              onClick={() =>
                setItems((old) => [
                  ...old,
                  {
                    sparePartId:
                      activeSpareparts.find(
                        (part) =>
                          !old.some((item) => item.sparePartId === part.id),
                      )?.id ?? "",
                    quantity: "1",
                    unitBuyPrice: "",
                  },
                ])
              }
            >
              Tambah item
            </button>
            <button
              disabled={
                saving || (editingMode !== "COMPLETED" && !items.length)
              }
              className="rounded bg-blue-700 px-4 py-2 text-white disabled:opacity-50"
              onClick={() => void saveDraft()}
            >
              {saving
                ? "Menyimpan…"
                : editingMode === "COMPLETED"
                  ? "Simpan Perubahan"
                  : editingId
                    ? "Simpan Draft"
                    : "Buat Draft"}
            </button>
            {editingId && (
              <button className="rounded border px-4 py-2" onClick={resetForm}>
                Batal
              </button>
            )}
          </div>
        </section>
      )}
      <section className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-xl font-semibold">Riwayat Purchase</h2>
          <div className="flex items-end gap-2">
            <label className="grid gap-1 text-sm">
              Tanggal riwayat
              <input className="rounded border px-3 py-2" type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
            </label>
            <button className="rounded bg-blue-700 px-3 py-2 text-white disabled:opacity-50" disabled={saving} onClick={() => void refresh()}>Tampilkan</button>
          </div>
        </div>
        {purchases.map((purchase) => (
          <article key={purchase.id} className="rounded border bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-semibold">
                  {purchase.purchaseNumber}{" "}
                  <span className="text-sm font-normal text-slate-600">
                    · {purchase.status}
                  </span>
                </h2>
                <p className="text-sm text-slate-600">
                  {purchase.transactionDisplay} ·{" "}
                  {purchase.supplierName || "Supplier belum diisi"}
                </p>
              </div>
              {admin && purchase.totalAmount !== undefined && (
                <strong>{money(purchase.totalAmount)}</strong>
              )}
            </div>
            <ul className="mt-3 divide-y">
              {purchase.items.map((item) => (
                <li
                  key={item.id ?? `${purchase.id}-${item.lineNumber}`}
                  className="flex flex-wrap justify-between gap-2 py-2 text-sm"
                >
                  <span>
                    {item.code} — {item.name} × {item.quantity}
                  </span>
                  {admin && item.unitBuyPrice && (
                    <span>{money(item.unitBuyPrice)} / item</span>
                  )}
                </li>
              ))}
            </ul>
            {admin && purchase.status === "DRAFT" && (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  disabled={saving}
                  className="rounded border px-3 py-1 disabled:opacity-50"
                  onClick={() => editDraft(purchase)}
                >
                  Edit Draft
                </button>
                <button
                  disabled={saving}
                  className="rounded bg-green-700 px-3 py-1 text-white disabled:opacity-50"
                  onClick={() => void confirmDraft(purchase)}
                >
                  Confirm
                </button>
                <button
                  disabled={saving}
                  className="rounded border border-red-300 px-3 py-1 text-red-800 disabled:opacity-50"
                  onClick={() => void deleteDraft(purchase)}
                >
                  Hapus Draft
                </button>
              </div>
            )}
            {admin && purchase.status === "COMPLETED" && (
              <div className="mt-3 flex flex-wrap gap-2">
                {(purchase.editCount ?? 0) < 1 && (
                  <button
                    disabled={saving}
                    className="rounded border px-3 py-1 disabled:opacity-50"
                    onClick={() => editCompleted(purchase)}
                  >
                    Edit Purchase (1 kali)
                  </button>
                )}
                <button
                  disabled={saving}
                  className="rounded border border-red-300 px-3 py-1 text-red-800 disabled:opacity-50"
                  onClick={() => void cancelCompleted(purchase)}
                >
                  Batalkan Purchase
                </button>
              </div>
            )}
          </article>
        ))}
        {!purchases.length && (
          <p className="rounded border bg-white p-4 text-slate-600">
            Belum ada Purchase.
          </p>
        )}
      </section>
    </main>
  );
}
