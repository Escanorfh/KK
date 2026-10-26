import type { Request, Response, NextFunction } from "express";
import * as dashboardService from "./dashboard.service";
import { withDbRetry, wakeDb } from "../../utils/db";

export async function summary(req: Request, res: Response, next: NextFunction) {
  try {
    await wakeDb();
    res.json(await withDbRetry(() => dashboardService.summary(req.scope)));
  } catch (err) {
    next(err);
  }
}
