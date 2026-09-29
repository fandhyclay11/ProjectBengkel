import { redirect } from "next/navigation";
import { currentSession } from "@/server/auth";
import { listMovementsForAdmin } from "@/server/stock-service";
import { listSpareParts } from "@/server/sparepart-service";

export default async function StockCardPage({ searchParams }: { searchParams: Promise<{ sparePartId?: string }> }) {
  const session = await currentSession();
  if (!session) redirect("/");
  if (session.user.mustChangePassword) redirect("/ganti-password");
  if (session.user.role !== "ADMIN") redirect("/beranda");
  const params = await searchParams;
  const sparePartId = params.sparePartId && /^\d{1,19}$/.test(params.sparePartId) && BigInt(params.sparePartId) > 0n && BigInt(params.sparePartId) <= 9_223_372_036_854_775_807n
    ? BigInt(params.sparePartId)
    : undefined;
  const [movements, spareparts] = await Promise.all([listMovementsForAdmin(sparePartId), listSpareParts("ADMIN")]);
  return <main className="mx-auto max-w-6xl p-6">
    <a href="/beranda" className="text-sm text-blue-700">← Beranda</a>
    <h1 className="mt-3 text-2xl font-semibold">Kartu Stok</h1>
    <p className="mt-2 text-sm text-slate-600">Riwayat pergerakan stok. Data ini hanya dapat dilihat Admin.</p>
    <form className="my-4 flex gap-2" action="/stock-card">
      <select className="rounded border px-3 py-2" name="sparePartId" defaultValue={params.sparePartId ?? ""}>
        <option value="">Semua sparepart</option>
        {spareparts.map((part) => <option key={part.id} value={part.id}>{part.code} — {part.name}</option>)}
      </select>
      <button className="rounded border px-3 py-2">Filter</button>
    </form>
    <div className="overflow-x-auto rounded border bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b bg-slate-50"><tr>{["Waktu", "Sparepart", "Jenis", "Jumlah (pcs)", "Sumber"].map((heading) => <th key={heading} className="p-3">{heading}</th>)}</tr></thead>
        <tbody>{movements.map((movement) => <tr key={movement.id} className="border-b last:border-0">
          <td className="whitespace-nowrap p-3">{new Intl.DateTimeFormat("id-ID", { timeZone: process.env.APP_WORKSHOP_TIMEZONE || "Asia/Jakarta", dateStyle: "medium", timeStyle: "short" }).format(new Date(movement.occurredAt))}</td>
          <td className="p-3">{movement.code} — {movement.name}</td><td className="p-3">{movement.type}</td>
          <td className="p-3">{BigInt(movement.quantity).toLocaleString("id-ID")}</td><td className="p-3">{movement.sourceType}</td>
        </tr>)}{movements.length === 0 && <tr><td className="p-4 text-slate-500" colSpan={5}>Belum ada pergerakan stok.</td></tr>}</tbody>
      </table>
    </div>
  </main>;
}
