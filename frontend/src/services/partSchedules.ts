import api from "@/lib/api";
import type { PartSchedule } from "@/types";

export type PartSchedulePayload = {
  equipmentId: number;
  partName: string;
  interval: number;
  unit: string;
};

export async function listPartSchedules(equipmentId: number) {
  const { data } = await api.get<PartSchedule[]>("/part-schedules", {
    params: { equipmentId },
  });
  return data;
}

export async function createPartSchedule(payload: PartSchedulePayload) {
  const { data } = await api.post<{ record: PartSchedule }>("/part-schedules", payload);
  return data.record;
}

export async function updatePartSchedule(id: number, payload: Partial<PartSchedulePayload>) {
  const { data } = await api.put<{ record: PartSchedule }>(`/part-schedules/${id}`, payload);
  return data.record;
}

export async function deletePartSchedule(id: number) {
  const { data } = await api.delete<{ message: string }>(`/part-schedules/${id}`);
  return data;
}

export type OverallStatus = "OIL_AND_FILTER" | "OIL" | "DUE_SOON" | "SAFE" | "UNKNOWN";
// OIL_DUE = قائمة معدات الزيت كاملة (OIL + OIL_AND_FILTER)
export type AlertStatusFilter = OverallStatus | "OIL_DUE" | "MODE_UNCONFIRMED";
export type TrackingMode = "HOURS" | "KM" | "BOTH";
export type ServiceStatus =
  | "OVERDUE"
  | "DUE"
  | "DUE_SOON"
  | "SAFE"
  | "UNKNOWN"
  | "NOT_APPLICABLE";
export type OilDueBy = "HOURS" | "KM" | "BOTH";
export type OilAlertState =
  | "MODE_UNCONFIRMED"
  | "VERIFY_DATA"
  | "BOTH_OVERDUE"
  | "HOURS_OVERDUE"
  | "KM_OVERDUE"
  | "BOTH_DUE"
  | "HOURS_DUE"
  | "KM_DUE"
  | "BOTH_DUE_SOON"
  | "HOURS_DUE_SOON"
  | "KM_DUE_SOON"
  | "OK";

export interface ServiceAlert {
  interval: number;
  isDefault: boolean;
  lastDate: string | null;
  lastMeter: number | null;
  elapsed: number | null;
  remaining: number | null;
  percent: number | null;
  status: ServiceStatus;
}

export interface EquipmentAlert {
  equipmentId: number;
  code: string;
  name: string;
  projectName: string | null;
  categoryName: string | null;
  trackingMode: TrackingMode;
  trackingModeConfirmed: boolean;
  modeUnconfirmed: boolean;
  currentMeter: number | null;
  currentKm: number | null;
  oil: ServiceAlert;
  oilKm: ServiceAlert;
  filter: ServiceAlert;
  filterKm: ServiceAlert;
  status: OverallStatus;
  oilState: OilAlertState;
  oilDueBy: OilDueBy | null;
  filterDue: boolean;
  filterAlert: boolean;
  hoursDataMissing: boolean;
  kmDataMissing: boolean;
}

export interface AlertsResponse {
  rows: EquipmentAlert[];
  summary: {
    oilAndFilter: number;
    oil: number;
    filter: number;
    dueSoon: number;
    safe: number;
    unknown: number;
    unconfirmed: number;
    oilDue: number;
    filterDue: number;
    total: number;
  };
}

export async function getPartAlerts(
  params: { status?: AlertStatusFilter; projectId?: number; q?: string } = {}
) {
  const { data } = await api.get<AlertsResponse>("/part-schedules/alerts", { params });
  return data;
}
