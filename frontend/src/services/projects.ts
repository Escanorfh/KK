import api from "@/lib/api";
import type { Paginated, Project, Sector } from "@/types";

export type SectorRow = Sector & {
  _count?: { equipment: number };
  project?: { id: number; name: string };
};

export type ProjectPayload = {
  code?: string | null;
  name: string;
  description?: string | null;
};

export async function projectOptions() {
  const { data } = await api.get<Pick<Project, "id" | "code" | "name">[]>("/projects/options");
  return data;
}

export async function listProjects(params: Record<string, unknown> = {}) {
  const { data } = await api.get<Paginated<Project> & { lastLogDate?: string | null }>("/projects", { params });
  return data;
}

export async function createProject(payload: ProjectPayload) {
  const { data } = await api.post<Project>("/projects", payload);
  return data;
}

export async function updateProject(id: number, payload: Partial<ProjectPayload>) {
  const { data } = await api.put<Project>(`/projects/${id}`, payload);
  return data;
}

export async function deleteProject(id: number) {
  const { data } = await api.delete<{ message: string }>(`/projects/${id}`);
  return data;
}

/** مزامنة فورية للمشاريع وقطاعاتها (/requisitions/projects + rooms[]) — متاحة لـ ROOT فقط */
export async function syncProjectsFromManagers() {
  const { data } = await api.post<{
    fetched: number;
    created: number;
    updated: number;
    unchanged: number;
    sectors: { created: number; linked: number; unchanged: number; skipped: number; stale: number; error: string | null };
  }>("/data/sync-projects");
  return data;
}

export async function listSectors(projectId?: number) {
  const { data } = await api.get<SectorRow[]>("/sectors", {
    params: projectId ? { projectId } : {},
  });
  return data;
}

export async function createSector(payload: { projectId: number; name: string }) {
  const { data } = await api.post<Sector>("/sectors", payload);
  return data;
}

export async function updateSector(id: number, name: string) {
  const { data } = await api.put<Sector>(`/sectors/${id}`, { name });
  return data;
}

export async function deleteSector(id: number) {
  const { data } = await api.delete<{ message: string }>(`/sectors/${id}`);
  return data;
}

export interface ManagersSectorOption {
  id: number;
  title: string;
}

/** القطاعات (الغرف) المصرّح بها للتوكن عند المدرين للمشروع المحلي — للمراجعة البشرية قبل الربط */
export async function managersSectorOptions(projectId: number) {
  const { data } = await api.get<{
    project: { id: number; name: string };
    remoteProject: { id: number; title: string; code: string | null } | null;
    rooms: ManagersSectorOption[];
    warning: string | null;
  }>("/sectors/managers-rooms", { params: { projectId } });
  return data;
}

/** ربط القطاع المحلي بقطاع المدرين المختار يدويًا — null لإلغاء الربط */
export async function linkSectorManagersRoom(sectorId: number, managersRoomId: number | null) {
  const { data } = await api.put<Sector>(`/sectors/${sectorId}/managers-room`, { managersRoomId });
  return data;
}
