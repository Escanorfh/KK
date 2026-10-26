import api, { isOfflineError } from "@/lib/api";
import { queueWrite, type Queued } from "@/lib/offline/queue";
import type { Paginated } from "@/types";

export type RepairOrderStatus = "PENDING" | "RECEIVED" | "IN_REPAIR" | "REPAIRED" | "LOADED" | "RETURNED";
export type RepairItemCondition = "عاطلة" | "صالح" | "هالك";

export const REPAIR_ITEM_CONDITIONS: RepairItemCondition[] = ["عاطلة", "صالح", "هالك"];

export const REPAIR_UNITS = ["عدد", "قطعة", "طقم", "لتر", "متر", "كجم"];

export interface RepairPart {
  id?: number;
  name: string;
  code?: string | null;
  qty?: number | null;
  notes?: string | null;
}

export interface RepairOrder {
  id: number;
  requestNo: number;
  type: "INTERNAL" | "EXTERNAL";
  entryDate?: string | null;
  exitDate?: string | null;
  hours?: number | null;
  km?: number | null;
  workshop?: string | null;
  faultDescription: string;
  actionTaken?: string | null;
  itemName?: string | null;
  partModel?: string | null;
  itemCode?: string | null;
  technicalCode?: string | null;
  quantity: number;
  unit: string;
  itemCondition: string;
  siteName?: string | null;
  requesterName?: string | null;
  sourceWarehouseId?: number | null;
  destinationWarehouseId?: number | null;
  technicianPhone?: string | null;
  imageUrl?: string | null;
  imageBase64?: string | null;
  estimatedCost?: number | null;
  actualCost?: number | null;
  notes?: string | null;
  status: RepairOrderStatus;
  sentAt?: string | null;
  sendError?: string | null;
  managersRef?: string | null;
  managersId?: number | null;
  managersStatus?: string | null;
  managersStatusLabel?: string | null;
  managersSyncedAt?: string | null;
  createdAt: string;
  equipment: {
    id: number;
    code: string;
    name: string;
    project?: { id: number; name: string; code?: string | null } | null;
    sector?: { id: number; name: string } | null;
  };
  project?: { id: number; name: string } | null;
  sector?: { id: number; name: string } | null;
  createdBy?: { id: number; name: string } | null;
  parts?: RepairPart[];
  events?: {
    id: number;
    status: RepairOrderStatus;
    note?: string | null;
    createdAt: string;
    user?: { id: number; name: string } | null;
  }[];
}

export interface RepairOrderPayload {
  id?: number;
  type: "INTERNAL" | "EXTERNAL";
  equipmentId: number;
  entryDate?: string | null;
  exitDate?: string | null;
  hours?: number | null;
  km?: number | null;
  workshop?: string | null;
  faultDescription: string;
  actionTaken?: string | null;
  itemName: string;
  partModel?: string | null;
  itemCode?: string | null;
  technicalCode?: string | null;
  quantity: number;
  unit: string;
  itemCondition: RepairItemCondition;
  siteName?: string | null;
  requesterName?: string | null;
  sourceWarehouseId?: number | null;
  destinationWarehouseId?: number | null;
  technicianPhone?: string | null;
  imageUrl?: string | null;
  imageBase64?: string | null;
  estimatedCost?: number | null;
  actualCost?: number | null;
  notes?: string | null;
  parts: RepairPart[];
}

export async function createRepairOrder(
  payload: RepairOrderPayload
): Promise<{ record: RepairOrder } | Queued> {
  try {
    const { data } = await api.post<{ record: RepairOrder }>("/repair-orders", payload);
    return data;
  } catch (err) {
    if (!isOfflineError(err)) throw err;
    await queueWrite({
      kind: `طلب إصلاح — ${payload.itemName}`,
      method: "post",
      url: "/repair-orders",
      data: payload,
    });
    return { queued: true };
  }
}

export async function listRepairOrders(params: Record<string, unknown> = {}) {
  const { data } = await api.get<Paginated<RepairOrder>>("/repair-orders", { params });
  return data;
}

export async function getRepairOrder(id: number) {
  const { data } = await api.get<{ record: RepairOrder }>(`/repair-orders/${id}`);
  return data;
}

export async function updateRepairOrder(
  id: number,
  payload: RepairOrderPayload
): Promise<{ record: RepairOrder } | Queued> {
  try {
    const { data } = await api.put<{ record: RepairOrder }>(`/repair-orders/${id}`, payload);
    return data;
  } catch (err) {
    if (!isOfflineError(err)) throw err;
    await queueWrite({
      kind: `تعديل طلب إصلاح رقم ${id}`,
      method: "put",
      url: `/repair-orders/${id}`,
      data: payload,
    });
    return { queued: true };
  }
}

export async function changeRepairOrderStatus(id: number, status: RepairOrderStatus, note?: string | null) {
  const { data } = await api.post<{ record: RepairOrder }>(`/repair-orders/${id}/status`, { status, note });
  return data;
}

export async function sendRepairOrder(id: number) {
  const { data } = await api.post<{ record: RepairOrder }>(`/repair-orders/${id}/send`);
  return data;
}

export async function syncRepairOrder(id: number) {
  const { data } = await api.post<{ record: RepairOrder }>(`/repair-orders/${id}/sync`);
  return data;
}

export async function deleteRepairOrder(id: number) {
  const { data } = await api.delete<{ message: string }>(`/repair-orders/${id}`);
  return data;
}

export const REPAIR_STATUS_LABELS: Record<RepairOrderStatus, string> = {
  PENDING: "بانتظار المدير",
  RECEIVED: "تم الاستلام",
  IN_REPAIR: "قيد الإصلاح",
  REPAIRED: "تم الإصلاح",
  LOADED: "تم التحميل",
  RETURNED: "تم الاستلام بالموقع",
};

export const REPAIR_STATUS_CLS: Record<RepairOrderStatus, string> = {
  PENDING: "bg-slate-100 text-slate-600",
  RECEIVED: "bg-blue-100 text-blue-700",
  IN_REPAIR: "bg-amber-100 text-amber-700",
  REPAIRED: "bg-emerald-100 text-emerald-700",
  LOADED: "bg-cyan-100 text-cyan-700",
  RETURNED: "bg-green-100 text-green-700",
};

export const NEXT_STATUS_LABEL: Partial<Record<RepairOrderStatus, { next: RepairOrderStatus; label: string }>> = {
  PENDING: { next: "RECEIVED", label: "تم الاستلام بالمركز" },
  RECEIVED: { next: "IN_REPAIR", label: "تسليم الورشة" },
  IN_REPAIR: { next: "REPAIRED", label: "تم الإصلاح" },
  REPAIRED: { next: "LOADED", label: "تم التحميل" },
  LOADED: { next: "RETURNED", label: "تم الاستلام بالموقع" },
};

export const STATUS_FLOW: RepairOrderStatus[] = ["PENDING", "RECEIVED", "IN_REPAIR", "REPAIRED", "LOADED", "RETURNED"];
