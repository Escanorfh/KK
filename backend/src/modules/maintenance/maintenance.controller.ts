import type { Request, Response, NextFunction } from "express";
import * as maintenanceService from "./maintenance.service";
import * as reviewService from "../review/review.service";

type ListQuery = {
  q?: string;
  date?: string;
  dateFrom?: string;
  dateTo?: string;
  endDateFrom?: string;
  endDateTo?: string;
  equipmentId?: number;
  projectId?: number;
  sectorId?: number;
  code?: string;
  name?: string;
  orderType?: string;
  maintenanceType?: string;
  workshop?: string;
  description?: string;
  notes?: string;
  user?: string;
  part?: string;
  workOrderNo?: number;
  meterFrom?: number;
  meterTo?: number;
  status?: "NEW" | "IN_PROGRESS" | "DONE" | "WAITING_PARTS";
  workType?: "MAINTENANCE" | "REPAIR";
  scope?: number[] | null;
  page: number;
  pageSize: number;
};

export async function save(req: Request, res: Response, next: NextFunction) {
  try {
    const role = req.user!.role;
    if (role === "ROOT" || role === "ADMIN") {
      const result = await maintenanceService.create(req.body, req.user!.id);
      res.status(201).json(result);
      return;
    }
    await maintenanceService.ensureEquipment(req.body.equipmentId);
    const clientCtx = req.body?.context;
    const isOffline = clientCtx?.capturedOffline === true;
    let context;
    if (isOffline) {
      context = clientCtx;
    } else {
      context = await maintenanceService.equipmentContext(req.body.equipmentId);
    }
    const result = await reviewService.createReviewRequest(
      {
        entity: "maintenance",
        data: req.body,
        clientRequestId: req.body?.clientRequestId,
        context,
      },
      req.user!.id,
    );
    res.status(202).json({ ...result, pendingReview: true });
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await maintenanceService.update(Number(req.params.id), req.body, req.user!.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const query = (req as Request & { validatedQuery: ListQuery }).validatedQuery;
    res.json(await maintenanceService.list({ ...query, scope: req.scope }));
  } catch (err) {
    next(err);
  }
}

export async function all(req: Request, res: Response, next: NextFunction) {
  try {
    const query = (req as Request & { validatedQuery: ListQuery }).validatedQuery;
    res.json(await maintenanceService.listAll({ ...query, scope: req.scope }));
  } catch (err) {
    next(err);
  }
}

export async function exportCsv(req: Request, res: Response, next: NextFunction) {
  try {
    const query = (req as Request & { validatedQuery: ListQuery }).validatedQuery;
    const csv = await maintenanceService.exportRows({ ...query, scope: req.scope });
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="workorders-${stamp}.csv"`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await maintenanceService.remove(Number(req.params.id), req.user!.id));
  } catch (err) {
    next(err);
  }
}
