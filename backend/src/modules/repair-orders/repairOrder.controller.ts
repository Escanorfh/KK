import type { Request, Response, NextFunction } from "express";
import * as repairOrderService from "./repairOrder.service";
import { withDbRetry, wakeDb } from "../../utils/db";
import type { RepairOrderStatus } from "@prisma/client";

type ListQuery = {
  q?: string;
  status?: RepairOrderStatus;
  projectId?: number;
  equipmentId?: number;
  type?: "INTERNAL" | "EXTERNAL";
  scope?: number[] | null;
  page: number;
  pageSize: number;
};

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await withDbRetry(() => repairOrderService.create(req.body, req.user!.id));
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const query = (req as Request & { validatedQuery: ListQuery }).validatedQuery;
    res.json(await withDbRetry(() => repairOrderService.list({ ...query, scope: req.scope })));
  } catch (err) {
    next(err);
  }
}

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    await wakeDb();
    res.json(await withDbRetry(() => repairOrderService.get(Number(req.params.id))));
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await withDbRetry(() => repairOrderService.update(Number(req.params.id), req.body, req.user!.id));
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function changeStatus(req: Request, res: Response, next: NextFunction) {
  try {
    const { status, note } = req.body as { status: RepairOrderStatus; note?: string | null };
    const result = await withDbRetry(() =>
      repairOrderService.changeStatus(Number(req.params.id), status, note ?? null, req.user!.id)
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function send(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await withDbRetry(() => repairOrderService.send(Number(req.params.id), req.user!.id));
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function sync(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await withDbRetry(() => repairOrderService.sync(Number(req.params.id), req.user!.id));
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await withDbRetry(() => repairOrderService.remove(Number(req.params.id), req.user!.id)));
  } catch (err) {
    next(err);
  }
}
