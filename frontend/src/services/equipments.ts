import api from "@/lib/api";
import type { Equipment, EquipmentCategory, Paginated, TrackingMode } from "@/types";

export async function lookupEquipment(code: string) {
  const { data } = await api.get<Equipment[]>("/equipments/lookup", { params: { code } });
  return data;
}

export async function createEquipment(payload: {
  code: string;
  name: string;
  projectId?: number | null;
  sectorId?: number | null;
  categoryId?: number | null;
  trackingMode?: TrackingMode;
  trackingModeConfirmed?: boolean;
}) {
  const { data } = await api.post<Equipment>("/equipments", payload);
  return data;
}

export async function updateEquipment(
  id: number,
  payload: Partial<{
    code: string;
    name: string;
    projectId: number | null;
    sectorId: number | null;
    categoryId: number | null;
    trackingMode: TrackingMode;
    trackingModeConfirmed: boolean;
  }>
) {
  const { data } = await api.put<Equipment>(`/equipments/${id}`, payload);
  return data;
}

export async function listCategories() {
  const { data } = await api.get<EquipmentCategory[]>("/equipments/categories");
  return data;
}

export async function createCategory(payload: {
  name: string;
  codePrefixes?: string[];
  defaultTrackingMode?: TrackingMode;
}) {
  const { data } = await api.post<EquipmentCategory>("/equipments/categories", payload);
  return data;
}

export async function updateCategory(
  id: number,
  payload: Partial<{
    name: string;
    codePrefixes: string[];
    defaultTrackingMode: TrackingMode;
  }>
) {
  const { data } = await api.put<EquipmentCategory>(`/equipments/categories/${id}`, payload);
  return data;
}

export async function deleteCategory(id: number) {
  const { data } = await api.delete<{ message: string }>(`/equipments/categories/${id}`);
  return data;
}

export interface TrackingReviewRow {
  equipmentId: number;
  code: string;
  name: string;
  projectName: string | null;
  categoryId: number | null;
  categoryName: string | null;
  trackingMode: TrackingMode;
  trackingModeOverridden: boolean;
  trackingModeConfirmed: boolean;
  hasHoursData: boolean;
  hasKmData: boolean;
  issues: string[];
}

export interface TrackingReview {
  rows: TrackingReviewRow[];
  summary: { total: number; review: number; unconfirmed: number };
}

export async function getTrackingReview() {
  const { data } = await api.get<TrackingReview>("/equipments/tracking-review");
  return data;
}

export interface MeterReset {
  id: number;
  equipmentId: number;
  date: string;
  hours: number | null;
  km: number | null;
  notes: string | null;
  createdAt: string;
}

export async function listMeterResets(equipmentId: number) {
  const { data } = await api.get<MeterReset[]>(`/equipments/${equipmentId}/meter-resets`);
  return data;
}

export async function createMeterReset(
  equipmentId: number,
  payload: { date: string; hours?: number | null; km?: number | null; notes?: string | null }
) {
  const { data } = await api.post<MeterReset>(`/equipments/${equipmentId}/meter-resets`, payload);
  return data;
}

export interface EquipmentAssignment {
  id: number;
  projectId: number | null;
  sectorId: number | null;
  projectSectorId: number | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  sourceSystem: string;
  sourceReference: string | null;
  project?: { id: number; code?: string | null; name: string } | null;
  sector?: { id: number; name: string } | null;
}

export async function listAssignments(equipmentId: number) {
  const { data } = await api.get<EquipmentAssignment[]>(`/equipments/${equipmentId}/assignments`);
  return data;
}

export async function listEquipments(params: Record<string, unknown> = {}) {
  const { data } = await api.get<Paginated<Equipment>>("/equipments", { params });
  return data;
}

export interface LastMeter {
  recordId: number;
  date: string;
  meter: number;
}

export async function getLastMeter(equipmentId: number, before?: string) {
  const { data } = await api.get<LastMeter | null>(`/equipments/${equipmentId}/last-meter`, {
    params: before ? { before } : {},
  });
  return data;
}

export interface ManagersSyncResult {
  fetched: number;
  created: number;
  updated: number;
  unchanged: number;
  projects: { id: number; name: string }[];
  sectors: number;
  errors: { code: string | null; message: string }[];
}

export async function syncEquipmentsFromManagers() {
  const { data } = await api.post<ManagersSyncResult>("/equipments/sync-managers");
  return data;
}
