import api from "@/lib/api";
import type { User } from "@/types";

export async function loginRequest(email: string, password: string) {
  const { data } = await api.post<{ token: string; user: User }>("/auth/login", {
    email,
    password,
  });
  return data;
}
