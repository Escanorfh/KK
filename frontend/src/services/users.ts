import api from "@/lib/api";
import type { Role } from "@/types";

export type AssignableRole = Exclude<Role, "ROOT">;

export interface ManagedUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  active: boolean;
  createdAt: string;
  projects?: { project: { id: number; name: string; code?: string | null } }[];
  _count?: { dailyLogs: number; maintenance: number };
}

export async function listUsers(q?: string) {
  const { data } = await api.get<{ data: ManagedUser[] }>("/users", {
    params: q ? { q } : {},
  });
  return data.data;
}

export async function createUser(input: {
  name: string;
  email: string;
  password: string;
  role: AssignableRole;
  projectIds: number[];
}) {
  const { data } = await api.post<{ user: ManagedUser }>("/users", input);
  return data.user;
}

export async function updateUser(
  id: number,
  input: {
    name?: string;
    email?: string;
    role?: AssignableRole;
    active?: boolean;
    password?: string;
    projectIds?: number[];
  }
) {
  const payload = Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined && v !== "")
  ) as typeof input;
  const { data } = await api.put<{ user: ManagedUser }>(`/users/${id}`, payload);
  return data.user;
}

export async function deleteUser(id: number) {
  const { data } = await api.delete<{ message: string }>(`/users/${id}`);
  return data;
}
