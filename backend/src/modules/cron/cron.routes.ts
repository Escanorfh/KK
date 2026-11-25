import { Router } from "express";
import * as dataService from "../data/data.service";
import * as equipmentService from "../equipments/equipment.service";
import prisma from "../../config/prisma";
import { withDbRetry } from "../../utils/db";

const router = Router();

function checkSecret(req: any, res: any): boolean {
  const secret = (process.env.CRON_SECRET || "").trim();
  if (!secret) {
    res.status(503).json({ message: "CRON_SECRET غير مُعد" });
    return false;
  }
  if (req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ message: "غير مصرح" });
    return false;
  }
  return true;
}

router.get("/projects-sync", async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    res.json(await withDbRetry(() => dataService.syncProjectsFromManagers()));
  } catch (err) {
    res.status(502).json({ message: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/equipment-sync", async (req, res) => {
  if (!checkSecret(req, res)) return;
  try {
    const user = await prisma.user.findFirst({ where: { role: "ROOT", active: true }, select: { id: true } });
    if (!user) throw new Error("لا يوجد مستخدم ROOT نشط لتنفيذ المزامنة");
    res.json(await withDbRetry(() => equipmentService.syncFromManagers(user.id)));
  } catch (err) {
    res.status(502).json({ message: err instanceof Error ? err.message : String(err) });
  }
});

export default router;