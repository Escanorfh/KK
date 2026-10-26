import api, { isOfflineError } from "@/lib/api";
import { queueWrite, type Queued } from "@/lib/offline/queue";
import type { DailyLog, Paginated } from "@/types";

export interface DailyLogPayload {
  id?: number;
  date: string;
  equipmentId: number;
  startMeter?: number | null;
  endMeter?: number | null;
  operatingHours?: number | null;
  diesel?: number | null;
  productivity?: string | null;
  condition?: "GOOD" | "BROKEN" | "STOPPED" | null;
  conditionNote?: string | null;
  notes?: string | null;
}

export async function saveDailyLog(
  payload: DailyLogPayload
): Promise<{ record: DailyLog; updated: boolean } | Queued> {
  try {
    const { data } = await api.post<{ record: DailyLog; updated: boolean }>("/dailylogs", payload);
    return data;
  } catch (err) {
    if (!isOfflineError(err)) throw err;
    await queueWrite({
      kind: `يومية معدة رقم ${payload.equipmentId} — ${payload.date}`,
      method: "post",
      url: "/dailylogs",
      data: payload,
    });
    return { queued: true };
  }
}

export async function listDailyLogs(params: Record<string, unknown> = {}) {
  const { data } = await api.get<Paginated<DailyLog>>("/dailylogs", { params });
  return data;
}

export async function listAllDailyLogs(params: Record<string, unknown> = {}) {
  const { data } = await api.get<{ data: DailyLog[]; total: number }>("/dailylogs/all", {
    params,
  });
  return data;
}

export async function exportDailyLogs(params: Record<string, unknown> = {}) {
  const { data } = await api.get<Blob>("/dailylogs/export", {
    params,
    responseType: "blob",
  });
  return data;
}
