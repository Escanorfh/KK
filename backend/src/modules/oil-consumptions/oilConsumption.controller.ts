import type { Request, Response, NextFunction } from "express";
import * as oilConsumptionService from "./oilConsumption.service";

type ListQuery = Parameters<typeof oilConsumptionService.list>[0];

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const query = (req as Request & { validatedQuery: ListQuery }).validatedQuery;
    res.json(await oilConsumptionService.list(query, req.scope ?? null));
  } catch (err) {
    next(err);
  }
}

export async function summary(req: Request, res: Response, next: NextFunction) {
  try {
    const query = (req as Request & { validatedQuery: ListQuery }).validatedQuery;
    res.json(await oilConsumptionService.summary(query, req.scope ?? null));
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await oilConsumptionService.create(req.body, req.user!.id);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await oilConsumptionService.update(Number(req.params.id), req.body, req.user!.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await oilConsumptionService.remove(Number(req.params.id), req.user!.id));
  } catch (err) {
    next(err);
  }
}

export async function sync(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await oilConsumptionService.syncFromMaintenance(req.user!.id, req.scope ?? null);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
