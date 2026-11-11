import type { Request, Response, NextFunction } from "express";
import * as dailylogService from "./dailylog.service";
import * as reviewService from "../review/review.service";

export async function save(req: Request, res: Response, next: NextFunction) {
  try {
    const role = req.user!.role;
    if (role === "ROOT" || role === "ADMIN") {
      const result = await dailylogService.save(req.body, req.user!.id);
      res.status(result.updated ? 200 : 201).json(result);
      return;
    }
    await dailylogService.ensureEquipment(req.body.equipmentId);
    const clientCtx = req.body?.context;
    const isOffline = clientCtx?.capturedOffline === true;
    let context;
    if (isOffline) {
      // preserve attested client snapshot; verification happens in createReviewRequest
      context = clientCtx;
    } else {
      context = await dailylogService.equipmentContext(req.body.equipmentId);
    }
    const result = await reviewService.createReviewRequest(
      {
        entity: "dailylog",
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
    const result = await dailylogService.update(Number(req.params.id), req.body, req.user!.id);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function productivityTypes(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await dailylogService.productivityTypes(req.scope));
  } catch (err) {
    next(err);
  }
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const query = (req as Request & {
      validatedQuery: {
        q?: string;
        date?: string;
        dateFrom?: string;
        dateTo?: string;
        equipmentId?: number;
        projectId?: number;
  sectorId?: number;
        condition?: "GOOD" | "BROKEN" | "STOPPED";
        page: number;
        pageSize: number;
      };
    }).validatedQuery;
    res.json(await dailylogService.list({ ...query, scope: req.scope }));
  } catch (err) {
    next(err);
  }
}

export async function exportCsv(req: Request, res: Response, next: NextFunction) {
  try {
    const query = (req as Request & {
      validatedQuery: {
        q?: string;
        date?: string;
        dateFrom?: string;
        dateTo?: string;
        equipmentId?: number;
        projectId?: number;
  sectorId?: number;
        condition?: "GOOD" | "BROKEN" | "STOPPED";
      };
    }).validatedQuery;
    const csv = await dailylogService.exportRows({ ...query, scope: req.scope });
    const stamp = new Date().toISOString().slice(0, 10);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="dailylogs-${stamp}.csv"`);
    res.send(csv);
  } catch (err) {
    next(err);
  }
}

export async function all(req: Request, res: Response, next: NextFunction) {
  try {
    const query = (req as Request & {
      validatedQuery: {
        q?: string;
        date?: string;
        dateFrom?: string;
        dateTo?: string;
        equipmentId?: number;
        projectId?: number;
  sectorId?: number;
        condition?: "GOOD" | "BROKEN" | "STOPPED";
      };
    }).validatedQuery;
    res.json(await dailylogService.listAll({ ...query, scope: req.scope }));
  } catch (err) {
    next(err);
  }
}

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await dailylogService.get(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
}
