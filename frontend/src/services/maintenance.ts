import api, { isOfflineError } from "@/lib/api";
import { queueWrite, type Queued } from "@/lib/offline/queue";
import type { Maintenance, Paginated, WorkPart } from "@/types";

export interface MaintenancePayload {
  id?: number;
  workOrderNo?: number | null;
  date: string;
  endDate?: string | null;
  equipmentId: number;
  workType?: "MAINTENANCE" | "REPAIR";
  orderType?: string | null;
  maintenanceType?: string | null;
  workshop?: string | null;
  description?: string | null;
  action?: string | null;
  meterReading?: number | null;
  kmMeter?: number | null;
  status?: "NEW" | "IN_PROGRESS" | "DONE" | "WAITING_PARTS";
  notes?: string | null;
  parts?: WorkPart[];
}

export async function createMaintenance(
  payload: MaintenancePayload
): Promise<Maintenance | Queued> {
  try {
    const { data } = await api.post<{ record: Maintenance }>("/maintenance", payload);
    return data.record;
  } catch (err) {
    if (!isOfflineError(err)) throw err;
    await queueWrite({
      kind: `أمر شغل — ${payload.date} (${payload.parts?.length ?? 0} صنف)`,
      method: "post",
      url: "/maintenance",
      data: payload,
    });
    return { queued: true };
  }
}

export async function updateMaintenance(
  id: number,
  payload: MaintenancePayload
): Promise<Maintenance | Queued> {
  try {
    const { data } = await api.put<{ record: Maintenance }>(`/maintenance/${id}`, payload);
    return data.record;
  } catch (err) {
    if (!isOfflineError(err)) throw err;
    await queueWrite({
      kind: `تعديل أمر شغل رقم ${id}`,
      method: "put",
      url: `/maintenance/${id}`,
      data: payload,
    });
    return { queued: true };
  }
}

export async function listMaintenance(params: Record<string, unknown> = {}) {
  const { data } = await api.get<Paginated<Maintenance>>("/maintenance", { params });
  return data;
}

export async function listAllMaintenance(params: Record<string, unknown> = {}) {
  const { data } = await api.get<{ data: Maintenance[]; total: number }>("/maintenance/all", {
    params,
  });
  return data;
}

export async function exportMaintenance(params: Record<string, unknown> = {}) {
  const { data } = await api.get<Blob>("/maintenance/export", {
    params,
    responseType: "blob",
  });
  return data;
}

export async function deleteMaintenance(id: number) {
  const { data } = await api.delete<{ message: string }>(`/maintenance/${id}`);
  return data;
}
