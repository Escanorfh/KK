import type { Request, Response, NextFunction } from "express";
import type { Role } from "@prisma/client";
import { verifyToken } from "../utils/jwt";
import { scopeProjectIds } from "../utils/scope";

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ message: "Unauthorized" });
  }
  let payload: { id: number; role: Role; name: string };
  try {
    payload = verifyToken(header.slice(7));
  } catch {
    return res.status(401).json({ message: "Invalid or expired token" });
  }
  req.user = payload;
  scopeProjectIds(payload)
    .then((scope) => {
      req.scope = scope;
      next();
    })
    .catch(next);
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ message: "Forbidden" });
    }
    next();
  };
}
