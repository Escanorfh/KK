import { Router } from "express";
import * as dataService from "../data/data.service";
import * as transferService from "../transfers/transfer.service";
import { withDbRetry } from "../../utils/db";

const router = Router();

// Vercel Cron بيبعت GET من غير جلسة، فالحماية بمفتاح سرّي مش بلوجن
router.get("/projects-sync", async (req, res) => {
  const secret = (process.env.CRON_SECRET || "").trim();
  if (!secret) {
    res.status(503).json({ message: "CRON_SECRET غير مُعد على هذه البيئة" });
    return;
  }
  if (req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ message: "غير مصرح" });
    return;
  }
  try {
    res.json(await withDbRetry(() => dataService.syncProjectsFromManagers()));
  } catch (err) {
    res.status(502).json({ message: err instanceof Error ? err.message : String(err) });
  }
});

router.get("/transfers-complete", async (req, res) => {
  const secret = (process.env.CRON_SECRET || "").trim();
  if (!secret) {
    res.status(503).json({ message: "CRON_SECRET غير مُعد" });
    return;
  }
  if (req.headers.authorization !== `Bearer ${secret}`) {
    res.status(401).json({ message: "غير مصرح" });
    return;
  }
  try {
    const count = await withDbRetry(() => transferService.completeDue());
    res.json({ completed: count });
  } catch (err) {
    res.status(502).json({ message: err instanceof Error ? err.message : String(err) });
  }
});

export default router;
