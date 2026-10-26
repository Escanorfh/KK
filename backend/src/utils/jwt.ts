import jwt, { type JwtPayload } from "jsonwebtoken";
import type { Role } from "@prisma/client";

const SECRET = process.env.JWT_SECRET || "dev-secret";
const EXPIRES_IN = process.env.JWT_EXPIRES_IN || "7d";

export interface TokenPayload extends JwtPayload {
  id: number;
  role: Role;
  name: string;
}

export function signToken(payload: { id: number; role: Role; name: string }) {
  return jwt.sign(payload, SECRET, { expiresIn: EXPIRES_IN } as jwt.SignOptions);
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, SECRET) as TokenPayload;
}
