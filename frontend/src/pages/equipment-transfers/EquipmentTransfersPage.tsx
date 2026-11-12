import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import { getApiError } from "@/lib/api";
import { listTransferRequests, type EquipmentTransferRequest } from "@/services/transferRequests";

export default function EquipmentTransfersPage() {
  const [rows, setRows] = useState<EquipmentTransferRequest[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    listTransferRequests({})
      .then((r) => { if (alive) setRows(r.data); })
      .catch((err) => toast(getApiError(err)))
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold text-slate-800">نقل المعدات</h1>
      <p className="text-xs text-slate-500">
        طلبات نقل المعدات بين المشاريع (قيد الانتظار). النقل الفعلي يتم عبر System المديرين؛ EFMS يسجل الطلب فقط.
      </p>
      {loading ? (
        <div className="py-10 text-center text-slate-400"><Loader2 className="inline animate-spin" /> جاري التحميل...</div>
      ) : rows.length === 0 ? (
        <div className="py-10 text-center text-slate-400">لا توجد طلبات نقل.</div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 text-xs text-slate-600">
                <th className="px-3 py-2 text-right">المعدة</th>
                <th className="px-3 py-2 text-right">من</th>
                <th className="px-3 py-2 text-right">إلى</th>
                <th className="px-3 py-2 text-right">التاريخ</th>
                <th className="px-3 py-2 text-right">الحالة</th>
                <th className="px-3 py-2 text-right">مقدم الطلب</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-slate-100">
                  <td className="px-3 py-2 font-mono text-xs">{r.equipment?.code} — {r.equipment?.name}</td>
                  <td className="px-3 py-2 text-xs">{r.sourceProject?.name || "—"} / {r.sourceSector?.name || "—"}</td>
                  <td className="px-3 py-2 text-xs">{r.destinationProject?.name} / {r.destinationSector?.name || "—"}</td>
                  <td className="px-3 py-2 text-xs" dir="ltr">{r.transferDate.slice(0, 10)}</td>
                  <td className="px-3 py-2 text-xs font-bold">{r.status}</td>
                  <td className="px-3 py-2 text-xs">{r.requester?.name}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
