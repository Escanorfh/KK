import api from "@/lib/api";
import type { Paginated } from "@/types";

export interface Transfer {
  id: number;
  equipmentId: number;
  equipment?: { code: string; name: string };
  fromProject?: { id: number; name: string } | null;
  fromSector?: { id: number; name: string } | null;
  toProject: { id: number; name: string };
  toSector?: { id: number; name: string } | null;
  transferDate: string;
  reason?: string | null;
  notes?: string | null;
  status: "PENDING" | "APPROVED" | "REJECTED" | "COMPLETED" | "CANCELLED";
  submittedBy?: { name: string };
  reviewedBy?: { name: string } | null;
  reviewedAt?: string | null;
  rejectionReason?: string | null;
  createdAt: string;
}

export async function listTransfers(params: Record<string, unknown> = {}) {
  const { data } = await api.get<Paginated<Transfer>>("/transfers", { params });
  return data;
}
export async function getTransfer(id: number) {
  const { data } = await api.get<Transfer>(`/transfers/${id}`);
  return data;
}
export async function getTransferStats() {
  const { data } = await api.get<{ total: number; pending: number; approved: number; completed: number; rejected: number }>("/transfers/stats");
  return data;
}
export async function createTransfer(payload: Record<string, unknown>) {
  const { data } = await api.post<Transfer>("/transfers", payload);
  return data;
}
export async function approveTransfer(id: number, payload: Record<string, unknown>) {
  const { data } = await api.post<Transfer>(`/transfers/${id}/approve`, payload);
  return data;
}
export async function rejectTransfer(id: number, reason: string) {
  const { data } = await api.post<Transfer>(`/transfers/${id}/reject`, { reason });
  return data;
}
export async function cancelTransfer(id: number) {
  const { data } = await api.post<Transfer>(`/transfers/${id}/cancel`);
  return data;
}
