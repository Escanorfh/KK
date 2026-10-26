import api, { isOfflineError } from "@/lib/api";
import { queueWrite, type Queued } from "@/lib/offline/queue";
import type { Paginated } from "@/types";

export type NeedRequestStatus = "DRAFT" | "SENT" | "FAILED";

export interface NeedRequestItem {
  id?: number;
  rowNo?: number;
  itemName: string;
  itemCode?: string | null;
  unit?: string | null;
  qty: number | null;
  equipmentRef?: string | null;
  currentBalance?: number | null;
  localSupply?: number | null;
  foreignSupply?: number | null;
  notes?: string | null;
}

export interface NeedRequest {
  id: number;
  requestNo: number;
  requestNoText: string;
  projectId?: number | null;
  project?: { id: number; name: string; code?: string | null } | null;
  department: string;
  requestDate: string;
  status: NeedRequestStatus;
  sentAt?: string | null;
  sendError?: string | null;
  managersRef?: string | null;
  managersId?: number | null;
  managersStatus?: string | null;
  managersStatusLabel?: string | null;
  managersSyncedAt?: string | null;
  createdAt: string;
  createdBy?: { id: number; name: string } | null;
  items?: NeedRequestItem[];
  _count?: { items: number };
}

export interface NeedRequestPayload {
  projectId?: number | null;
  department: string;
  requestDate: string;
  items: NeedRequestItem[];
}

export async function createNeedRequest(
  payload: NeedRequestPayload
): Promise<{ record: NeedRequest } | Queued> {
  try {
    const { data } = await api.post<{ record: NeedRequest }>("/need-requests", payload);
    return data;
  } catch (err) {
    if (!isOfflineError(err)) throw err;
    await queueWrite({
      kind: `طلب احتياج (${payload.items?.length ?? 0} صنف) — ${payload.requestDate}`,
      method: "post",
      url: "/need-requests",
      data: payload,
    });
    return { queued: true };
  }
}

export async function listNeedRequests(params: Record<string, unknown> = {}) {
  const { data } = await api.get<Paginated<NeedRequest>>("/need-requests", { params });
  return data;
}

export async function getNeedRequest(id: number) {
  const { data } = await api.get<{ record: NeedRequest }>(`/need-requests/${id}`);
  return data;
}

export async function updateNeedRequest(
  id: number,
  payload: NeedRequestPayload
): Promise<{ record: NeedRequest } | Queued> {
  try {
    const { data } = await api.put<{ record: NeedRequest }>(`/need-requests/${id}`, payload);
    return data;
  } catch (err) {
    if (!isOfflineError(err)) throw err;
    await queueWrite({
      kind: `تعديل طلب احتياج رقم ${id}`,
      method: "put",
      url: `/need-requests/${id}`,
      data: payload,
    });
    return { queued: true };
  }
}

export async function sendNeedRequest(id: number) {
  const { data } = await api.post<{ record: NeedRequest }>(`/need-requests/${id}/send`);
  return data;
}

export async function syncNeedRequest(id: number) {
  const { data } = await api.post<{ record: NeedRequest }>(`/need-requests/${id}/sync`);
  return data;
}

export async function deleteNeedRequest(id: number) {
  const { data } = await api.delete<{ message: string }>(`/need-requests/${id}`);
  return data;
}

export const NEED_STATUS_LABELS: Record<NeedRequestStatus, string> = {
  DRAFT: "مسودة",
  SENT: "تم الإرسال",
  FAILED: "فشل الإرسال",
};

export const NEED_STATUS_CLS: Record<NeedRequestStatus, string> = {
  DRAFT: "bg-slate-100 text-slate-600",
  SENT: "bg-emerald-100 text-emerald-700",
  FAILED: "bg-red-100 text-red-700",
};

export const NEED_STATUS_FLOW: NeedRequestStatus[] = ["DRAFT", "SENT", "FAILED"];
