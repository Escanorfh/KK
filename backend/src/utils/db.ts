import { Prisma } from "@prisma/client";
import prisma from "../config/prisma";

export function isDbConnectionError(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientInitializationError) return true;
  if (
    err instanceof Prisma.PrismaClientKnownRequestError &&
    ["P1001", "P1002", "P1008", "P1017"].includes(err.code)
  ) {
    return true;
  }
  if (err instanceof Error && err.message.includes("Can't reach database server")) return true;
  if (err instanceof Error && err.message.includes("Connection terminated")) return true;
  return false;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Neon بيقف بعد الخمول — إعادة المحاولة بتديه وقت يستيقظ ويعيد الاتصال
export async function withDbRetry<T>(
  fn: () => Promise<T>,
  tries = 4,
  baseDelayMs = 1200
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < tries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isDbConnectionError(err)) throw err;
      lastErr = err;
      if (attempt < tries - 1) await sleep(baseDelayMs * (attempt + 1));
    }
  }
  throw lastErr;
}

export async function wakeDb(): Promise<void> {
  await withDbRetry(() => prisma.$queryRaw`SELECT 1`, 5, 1000);
}

// يمنع Neon من الدخول في وضع الخمول طول عمر السيرفر (بينق كل 4 دقايق)
export function startDbKeepAlive(intervalMs = 4 * 60 * 1000) {
  const ping = async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      try {
        await wakeDb();
      } catch {
        /* هنحاول في اللفة الجاية */
      }
    }
  };
  void ping();
  const timer = setInterval(ping, intervalMs);
  timer.unref?.();
  return timer;
}
