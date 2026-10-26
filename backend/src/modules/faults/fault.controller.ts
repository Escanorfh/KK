import type { Request, Response, NextFunction } from "express";
import * as faultService from "./fault.service";

type ListQuery = {
  q?: string;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  equipmentId?: number;
  projectId?: number;
  status?: "NEW" | "IN_PROGRESS" | "DONE" | "WAITING_PARTS";
  scope?: number[] | null;
  page: number;
  pageSize: number;
};

export async function save(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await faultService.create(req.body, req.user!.id);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await faultService.update(Number(req.params.id), req.body, req.user!.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const query = (req as Request & { validatedQuery: ListQuery }).validatedQuery;
    res.json(await faultService.list({ ...query, scope: req.scope }));
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await faultService.remove(Number(req.params.id), req.user!.id));
  } catch (err) {
    next(err);
  }
}

type ReportQuery = {
  projectId?: number;
  date?: string;
  scope?: number[] | null;
};

export async function report(req: Request, res: Response, next: NextFunction) {
  try {
    const query = (req as Request & { validatedQuery: ReportQuery }).validatedQuery;
    res.json(await faultService.report({ ...query, scope: req.scope }));
  } catch (err) {
    next(err);
  }
}
