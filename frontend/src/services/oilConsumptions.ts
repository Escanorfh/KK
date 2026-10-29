import api from "@/lib/api";
import type { Paginated } from "@/types";

export type OilType = "ENGINE" | "HYDRAULIC" | "STEERING" | "GEARBOX" | "OTHER";
export type OilSource = "MANUAL" | "MAINTENANCE";

export const OIL_TYPES: OilType[] = ["ENGINE", "HYDRAULIC", "STEERING", "GEARBOX", "OTHER"];

export const OIL_TYPE_LABELS: Record<OilType, string> = {
  ENGINE: "زيت محرك",
  HYDRAULIC: "زيت هيدروليك",
  STEERING: "زيت فيتيس",
  GEARBOX: "زيت ترس",
  OTHER: "أخرى",
};

/** لون شارة النوع — يساعد في المراجعة السريعة وقت طلب الزيت */
export const OIL_TYPE_DOT: Record<OilType, string> = {
  ENGINE: "bg-blue-500",
  HYDRAULIC: "bg-purple-500",
  STEERING: "bg-emerald-500",
  GEARBOX: "bg-orange-500",
  OTHER: "bg-slate-400",
};

export const OIL_SOURCE_LABELS: Record<OilSource, string> = {
  MANUAL: "إدخال يدوي",
  MAINTENANCE: "من صيانة",
};

export interface OilConsumption {
  id: number;
  date: string;
  oilType: OilType;
  oilName: string | null;
  liters: number;
  pricePerLiter: number | null;
  totalAmount: number | null;
  source: OilSource;
  maintenanceId: number | null;
  notes: string | null;
  user: { name: string } | null;
  equipment: {
    id: number;
    code: string;
    name: string;
    project: { id: number; name: string } | null;
  };
}

export type OilConsumptionPayload = {
  date: string;
  equipmentId: number;
  oilType: OilType;
  oilName?: string | null;
  liters: number;
  pricePerLiter?: number | null;
  notes?: string | null;
};

export type OilConsumptionFilters = {
  page?: number;
  pageSize?: number;
  projectId?: number;
  equipmentId?: number;
  oilType?: OilType;
  source?: OilSource;
  from?: string;
  to?: string;
  q?: string;
};

export async function listOilConsumptions(params: OilConsumptionFilters = {}) {
  const { data } = await api.get<Paginated<OilConsumption>>("/oil-consumptions", { params });
  return data;
}

export type TypeBucket = { liters: number; amount: number | null; entries: number };

export interface OilSummaryRow {
  projectId: number | null;
  projectName: string;
  totalLiters: number;
  totalAmount: number | null;
  entries: number;
  byType: Record<OilType, TypeBucket>;
}

export interface OilSummaryResponse {
  projects: OilSummaryRow[];
  grand: {
    liters: number;
    amount: number | null;
    entries: number;
    byType: Record<OilType, TypeBucket>;
  };
  totalEntries: number;
}

export async function getOilConsumptionSummary(
  params: Omit<OilConsumptionFilters, "page" | "pageSize" | "q"> = {}
) {
  const { data } = await api.get<OilSummaryResponse>("/oil-consumptions/summary", { params });
  return data;
}

export async function createOilConsumption(payload: OilConsumptionPayload) {
  const { data } = await api.post<{ record: OilConsumption }>("/oil-consumptions", payload);
  return data.record;
}

export async function updateOilConsumption(id: number, payload: Partial<OilConsumptionPayload>) {
  const { data } = await api.put<{ record: OilConsumption }>(`/oil-consumptions/${id}`, payload);
  return data.record;
}

export async function deleteOilConsumption(id: number) {
  const { data } = await api.delete<{ message: string }>(`/oil-consumptions/${id}`);
  return data;
}

/** جلب استهلكات الزيوت تلقائيًا من أوامر الصيانة (idempotent) */
export async function syncOilConsumptions() {
  const { data } = await api.post<{ created: number; skipped: number; scanned: number }>(
    "/oil-consumptions/sync"
  );
  return data;
}
