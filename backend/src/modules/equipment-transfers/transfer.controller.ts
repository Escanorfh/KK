import { Request, Response, NextFunction } from "express";
import * as transferService from "./transfer.service";

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await transferService.createTransferRequest(req.body, req.user!.id));
  } catch (err) { next(err); }
}
export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await transferService.listTransferRequests({
      equipmentId: req.query.equipmentId ? Number(req.query.equipmentId) : undefined,
      status: req.query.status ? String(req.query.status) : undefined,
      page: req.query.page ? Number(req.query.page) : undefined,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined,
    }));
  } catch (err) { next(err); }
}
export async function get(req: Request, res: Response, next: NextFunction) {
  try { res.json(await transferService.getTransferRequest(Number(req.params.id))); }
  catch (err) { next(err); }
}
export async function cancel(req: Request, res: Response, next: NextFunction) {
  try {
    const isAdmin = req.user!.role === "ROOT" || req.user!.role === "ADMIN";
    res.json(await transferService.cancelTransferRequest(Number(req.params.id), req.user!.id, isAdmin));
  } catch (err) { next(err); }
}
export async function complete(req: Request, res: Response, next: NextFunction) {
  try { res.json(await transferService.reviewTransferRequest(Number(req.params.id), "COMPLETED", req.user!.id, req.body?.notes)); }
  catch (err) { next(err); }
}
export async function reject(req: Request, res: Response, next: NextFunction) {
  try { res.json(await transferService.reviewTransferRequest(Number(req.params.id), "REJECTED", req.user!.id, req.body?.notes)); }
  catch (err) { next(err); }
}
