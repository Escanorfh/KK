export type Role = "ROOT" | "ADMIN" | "MANAGER" | "USER";

export type TrackingMode = "HOURS" | "KM" | "BOTH";

export interface EquipmentCategory {
  id: number;
  name: string;
  codePrefixes: string[];
  defaultTrackingMode: TrackingMode;
  _count?: { equipment: number };
}

export interface User {
  id: number;
  name: string;
  email: string;
  role: Role;
  projects?: { id: number; name: string }[];
}

export interface Project {
  id: number;
  code?: string | null;
  name: string;
  description?: string | null;
  /** عدّاد المعدات من شيت الـ day (آخر يوم مسجل) — لو مفيش سجل يومي يرجع للإسناد الحالي */
  activeEquipment?: number;
  _count?: { equipment: number; sectors: number };
}

export interface Sector {
  id: number;
  projectId: number;
  name: string;
  /** معرّف قطاع نظام المدرين (room_id) — null يعني القطاع غير مربوط، فالإرسال يتمنع */
  managersRoomId?: number | null;
  managersRoomTitle?: string | null;
  /** عدّاد المعدات من شيت الـ day (آخر يوم مسجل) — لو مفيش سجل يومي يرجع للإسناد الحالي */
  activeEquipment?: number;
}

export interface Equipment {
  id: number;
  code: string;
  name: string;
  projectId?: number | null;
  sectorId?: number | null;
  categoryId?: number | null;
  trackingMode: TrackingMode;
  trackingModeOverridden: boolean;
  trackingModeConfirmed: boolean;
  category?: { id: number; name: string; defaultTrackingMode: TrackingMode } | null;
  project?: { id: number; name: string } | null;
  sector?: { id: number; name: string } | null;
  _count?: { dailyLogs: number; maintenance: number; faults: number };
}

export interface DailyLog {
  id: number;
  date: string;
  equipmentId: number;
  endMeter?: number | null;
  operatingHours?: number | null;
  diesel?: number | null;
  productivityType?: string | null;
  productivityCount?: number | null;
  condition?: "GOOD" | "BROKEN" | "STOPPED" | null;
  conditionNote?: string | null;
  notes?: string | null;
  equipment: {
    id: number;
    code: string;
    name: string;
    trackingMode: TrackingMode;
    project?: { id: number; name: string } | null;
    sector?: { id: number; name: string } | null;
  };
  user?: { id: number; name: string } | null;
}

export interface WorkPart {
  id?: number;
  name: string;
  code?: string | null;
  qty?: number | null;
  notes?: string | null;
}

export interface PartSchedule {
  id: number;
  equipmentId: number;
  partName: string;
  interval: number;
  unit: string;
  notes?: string | null;
}

export interface Maintenance {
  id: number;
  workOrderNo?: number | null;
  date: string;
  endDate?: string | null;
  equipmentId: number;
  workType: "MAINTENANCE" | "REPAIR";
  orderType?: string | null;
  maintenanceType?: string | null;
  workshop?: string | null;
  description?: string | null;
  action?: string | null;
  meterReading?: number | null;
  kmMeter?: number | null;
  downtime?: number | null;
  status: "NEW" | "IN_PROGRESS" | "DONE" | "WAITING_PARTS";
  notes?: string | null;
  workParts?: WorkPart[];
  equipment: {
    id: number;
    code: string;
    name: string;
    trackingMode: TrackingMode;
    trackingModeConfirmed: boolean;
    project?: { id: number; name: string } | null;
    sector?: { id: number; name: string } | null;
  };
  user?: { id: number; name: string } | null;
}

export interface Fault {
  id: number;
  date: string;
  equipmentId: number;
  description: string;
  cause?: string | null;
  faultType?: string | null;
  downtimeHours?: number | null;
  actionTaken?: string | null;
  status: "NEW" | "IN_PROGRESS" | "DONE" | "WAITING_PARTS";
  equipment: {
    id: number;
    code: string;
    name: string;
    project?: { id: number; name: string } | null;
    sector?: { id: number; name: string } | null;
  };
}

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiError {
  message: string;
  errors?: Record<string, string[]>;
}
