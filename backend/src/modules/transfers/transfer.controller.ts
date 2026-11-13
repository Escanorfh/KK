import type { Request, Response, NextFunction } from "express";
import * as transferService from "./transfer.service";

export async function stats(_req: Request, res: Response, next: NextFunction) {
  try { res.json(await transferService.stats()); } catch (e) { next(e); }
}
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const q = (req as any).validatedQuery;
    res.json(await transferService.list({ ...q, scope: req.scope }));
  } catch (e) { next(e); }
}
export async function get(req: Request, res: Response, next: NextFunction) {
  try { res.json(await transferService.get(Number(req.params.id))); } catch (e) { next(e); }
}
export async function create(req: Request, res: Response, next: NextFunction) {
  try { res.status(201).json(await transferService.create(req.body, req.user!.id)); } catch (e) { next(e); }
}
export async function approve(req: Request, res: Response, next: NextFunction) {
  try { res.json(await transferService.approve(Number(req.params.id), req.user!.id, req.body)); } catch (e) { next(e); }
}
export async function reject(req: Request, res: Response, next: NextFunction) {
  try { res.json(await transferService.reject(Number(req.params.id), req.user!.id, req.body.reason)); } catch (e) { next(e); }
}
export async function cancel(req: Request, res: Response, next: NextFunction) {
  try { res.json(await transferService.cancel(Number(req.params.id), req.user!.id)); } catch (e) { next(e); }
}
