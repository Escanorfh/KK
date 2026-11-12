import api from "@/lib/api";

export interface EquipmentTransferRequest {
  id: number;
  equipmentId: number;
  sourceProjectId: number | null;
  sourceSectorId: number | null;
  destinationProjectId: number;
  destinationSectorId: number | null;
  transferDate: string;
  reason: string | null;
  notes: string | null;
  status: "PENDING" | "COMPLETED" | "REJECTED" | "CANCELLED";
  requestedBy: number;
  createdAt: string;
  equipment?: { id: number; code: string; name: string };
  sourceProject?: { id: number; name: string } | null;
  sourceSector?: { id: number; name: string } | null;
  destinationProject?: { id: number; name: string };
  destinationSector?: { id: number; name: string } | null;
  requester?: { id: number; name: string };
}

export async function createTransferRequest(payload: {
  equipmentId: number;
  destinationProjectId: number;
  destinationSectorId: number;
  transferDate: string;
  reason?: string | null;
  notes?: string | null;
}) {
  const { data } = await api.post<EquipmentTransferRequest>("/equipment-transfers", payload);
  return data;
}

export async function listTransferRequests(params: { equipmentId?: number; status?: string } = {}) {
  const { data } = await api.get<{ data: EquipmentTransferRequest[]; total: number }>("/equipment-transfers", { params });
  return data;
}

export async function cancelTransferRequest(id: number) {
  const { data } = await api.post<EquipmentTransferRequest>(`/equipment-transfers/${id}/cancel`);
  return data;
}
