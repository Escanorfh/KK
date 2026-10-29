import api from "@/lib/api";

export interface DashboardSummary {
  totals: {
    equipment: number;
    dailyLogs: number;
    maintenance: number;
    faults: number;
    projects: number;
    sectors: number;
  };
  alertsSummary: Record<string, number>;
  monthly: {
    month: string;
    label: string;
    logs: number;
    hours: number;
    diesel: number;
    maintenance: number;
    maintDowntime: number;
    faults: number;
    faultDowntime: number;
  }[];
  faultsByStatus: { status: string; count: number }[];
  equipmentByProject: { name: string; count: number }[];
  /** تاريخ آخر يوم في السجل اليومي — توزيع المعدات على المشاريع محسوب منه */
  lastEquipmentLogDate?: string | null;
  conditions: { GOOD: number; BROKEN: number; STOPPED: number };
  topEquipment: { code: string; name: string; project: string | null; hours: number; diesel: number }[];
  recentFaults: {
    id: number;
    date: string;
    description: string;
    status: string;
    downtimeHours: number | null;
    equipment: { code: string; name: string };
  }[];
  recentMaintenance: {
    id: number;
    date: string;
    workOrderNo: number | null;
    description: string | null;
    status: string;
    workType: string;
    equipment: { code: string; name: string };
  }[];
  recentLogs: {
    id: number;
    date: string;
    operatingHours: number | null;
    diesel: number | null;
    condition: string | null;
    equipment: { code: string; name: string };
  }[];
}

export async function getDashboardSummary() {
  const { data } = await api.get<DashboardSummary>("/dashboard/summary");
  return data;
}
