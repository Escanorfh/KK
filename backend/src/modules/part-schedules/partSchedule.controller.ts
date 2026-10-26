import type { Request, Response, NextFunction } from "express";
import * as partScheduleService from "./partSchedule.service";

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const query = (req as Request & { validatedQuery: { equipmentId: number } }).validatedQuery;
    res.json(await partScheduleService.list(query.equipmentId));
  } catch (err) {
    next(err);
  }
}

export async function save(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await partScheduleService.create(req.body, req.user!.id);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await partScheduleService.update(Number(req.params.id), req.body, req.user!.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await partScheduleService.remove(Number(req.params.id), req.user!.id));
  } catch (err) {
    next(err);
  }
}

type AlertsQuery = {
  status?: "OIL_AND_FILTER" | "OIL" | "FILTER" | "SAFE" | "UNKNOWN" | "OIL_DUE";
  projectId?: number;
  q?: string;
  scope?: number[] | null;
};

export async function alerts(req: Request, res: Response, next: NextFunction) {
  try {
    const query = (req as Request & { validatedQuery: AlertsQuery }).validatedQuery;
    res.json(await partScheduleService.alerts({ ...query, scope: req.scope }));
  } catch (err) {
    next(err);
  }
}

export async function parts(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await partScheduleService.parts());
  } catch (err) {
    next(err);
  }
}
