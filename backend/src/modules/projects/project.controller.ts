import type { Request, Response, NextFunction } from "express";
import * as projectService from "./project.service";
import * as sectorService from "../sectors/sector.service";

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const { q, page, pageSize } = (req as Request & {
      validatedQuery: { q?: string; page: number; pageSize: number };
    }).validatedQuery;
    const result = await projectService.list({ q, page, pageSize, scope: req.scope });
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function options(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await projectService.options(req.scope));
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const project = await projectService.create(req.body, req.user!.id);
    res.status(201).json(project);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    const project = await projectService.update(id, req.body, req.user!.id);
    res.json(project);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await projectService.remove(Number(req.params.id), req.user!.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function listSectors(req: Request, res: Response, next: NextFunction) {
  try {
    const projectId = Number(req.params.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) {
      return res.status(400).json({ message: "معرّف المشروع غير صالح" });
    }
    res.json(await sectorService.listProjectSectors(projectId, req.scope));
  } catch (err) {
    next(err);
  }
}
