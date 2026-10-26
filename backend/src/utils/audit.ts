import prisma from "../config/prisma";

export async function logAudit(
  userId: number | null,
  entity: string,
  recordId: number,
  action: "CREATE" | "UPDATE" | "DELETE",
  details?: unknown
) {
  try {
    await prisma.auditLog.create({
      data: {
        userId,
        entity,
        recordId,
        action,
        details: details === undefined ? undefined : JSON.parse(JSON.stringify(details)),
      },
    });
  } catch (err) {
    console.error("Audit log failed:", err);
  }
}
