import { Navigate, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { useAuth } from "@/context/AuthContext";
import type { Role } from "@/types";

export default function RequireAuth({
  children,
  roles,
}: {
  children: ReactNode;
  roles?: Role[];
}) {
  const { token, user } = useAuth();
  const location = useLocation();

  if (!token) {
    return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  }
  if (roles && user && !roles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />;
  }
  return <>{children}</>;
}
