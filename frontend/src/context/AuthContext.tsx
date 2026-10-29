import { createContext, useContext, useState, type ReactNode } from "react";
import type { User } from "@/types";
import { clearKv } from "@/lib/offline/db";

interface AuthContextValue {
  token: string | null;
  user: User | null;
  login: (token: string, user: User) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("efms_token"));
  const [user, setUser] = useState<User | null>(() => {
    const raw = localStorage.getItem("efms_user");
    return raw ? (JSON.parse(raw) as User) : null;
  });

  const login = (newToken: string, newUser: User) => {
    void clearKv().catch(() => undefined);
    localStorage.setItem("efms_token", newToken);
    localStorage.setItem("efms_user", JSON.stringify(newUser));
    setToken(newToken);
    setUser(newUser);
  };

  const logout = () => {
    void clearKv().catch(() => undefined);
    localStorage.removeItem("efms_token");
    localStorage.removeItem("efms_user");
    setToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ token, user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
