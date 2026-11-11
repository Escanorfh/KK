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
    const sector = await sectorService.create(req.body, req.user!.id, req.scope);
    res.status(201).json(sector);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const sector = await sectorService.update(
      Number(req.params.id),
      req.body.name,
      req.user!.id,
      req.scope
    );
    res.json(sector);
  } catch (err) {
    next(err);
  }
}

export async function listProjects(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await sectorService.listSectorProjects(Number(req.params.id), req.scope));
  } catch (err) {
    next(err);
  }
}

export async function associateProject(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId } = req.body as { projectId: number };
    const link = await sectorService.associateToProject(
      Number(req.params.id),
      projectId,
      req.user!.id,
      req.scope
    );
    res.status(201).json(link);
  } catch (err) {
    next(err);
  }
}

export async function removeProject(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await sectorService.removeFromProject(
      Number(req.params.id),
      Number(req.params.projectId),
      req.user!.id,
      req.scope
    );
    res.json(result);
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

export async function managersRooms(req: Request, res: Response, next: NextFunction) {
  try {
    const { projectId } = (req as Request & { validatedQuery: { projectId: number } }).validatedQuery;
    res.json(await sectorService.managersRooms(projectId, req.scope));
  } catch (err) {
    next(err);
  }
}

export async function linkManagersRoom(req: Request, res: Response, next: NextFunction) {
  try {
    const { managersRoomId } = req.body as { managersRoomId: number | null };
    const sector = await sectorService.linkManagersRoom(Number(req.params.id), managersRoomId, req.user!.id);
    res.json(sector);
  } catch (err) {
    next(err);
  }
}
