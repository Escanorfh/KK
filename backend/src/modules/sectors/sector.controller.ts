import type { Request, Response, NextFunction } from "express";
import * as sectorService from "./sector.service";

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId } = (req as Request & {
      validatedQuery: { projectId?: number };
    }).validatedQuery;
    res.json(await sectorService.list(projectId, req.scope));
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const sector = await sectorService.create(req.body, req.user!.id);
    res.status(201).json(sector);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const sector = await sectorService.update(Number(req.params.id), req.body.name, req.user!.id);
    res.json(sector);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await sectorService.remove(Number(req.params.id), req.user!.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
