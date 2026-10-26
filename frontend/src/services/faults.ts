import api from "@/lib/api";
import type { Fault, Paginated } from "@/types";

export interface FaultPayload {
  date: string;
  equipmentId: number;
  description: string;
  cause?: string | null;
  faultType?: string | null;
  downtimeHours?: number | null;
  actionTaken?: string | null;
  status?: "NEW" | "IN_PROGRESS" | "DONE" | "WAITING_PARTS";
}

export async function createFault(payload: FaultPayload) {
  const { data } = await api.post<{ record: Fault }>("/faults", payload);
  return data.record;
}

export async function updateFault(id: number, payload: Partial<FaultPayload>) {
  const { data } = await api.put<{ record: Fault; updated: boolean }>(`/faults/${id}`, payload);
  return data.record;
}

export async function listFaults(params: Record<string, unknown> = {}) {
  const { data } = await api.get<Paginated<Fault>>("/faults", { params });
  return data;
}

export async function deleteFault(id: number) {
  const { data } = await api.delete<{ message: string }>(`/faults/${id}`);
  return data;
}

export interface FaultReport {
  date: string;
  project: { id: number; name: string } | null;
  summary: { broken: number; stopped: number; good: number; total: number };
  rows: { equipmentId: number; code: string; name: string; note: string }[];
}

export async function getFaultReport(params: { projectId?: number; date?: string } = {}) {
  const { data } = await api.get<FaultReport>("/faults/report", { params });
  return data;
}
