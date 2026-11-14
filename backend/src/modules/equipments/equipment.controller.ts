import type { Request, Response, NextFunction } from "express";
import * as equipmentService from "./equipment.service";

export async function lookup(req: Request, res: Response, next: NextFunction) {
  try {
    const { code } = (req as Request & { validatedQuery: { code: string } }).validatedQuery;
    res.json(await equipmentService.lookup(code, req.scope));
  } catch (err) {
    next(err);
  }
}

export async function lastMeter(req: Request, res: Response, next: NextFunction) {
  try {
    const { before } = (req as Request & { validatedQuery: { before?: string } }).validatedQuery;
    res.json(await equipmentService.lastMeter(Number(req.params.id), before));
  } catch (err) {
    next(err);
  }
}

export async function listMeterResets(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await equipmentService.listMeterResets(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
}

export async function createMeterReset(req: Request, res: Response, next: NextFunction) {
  try {
    const record = await equipmentService.createMeterReset(
      Number(req.params.id),
      req.body,
      req.user!.id
    );
    res.status(201).json(record);
  } catch (err) {
    next(err);
  }
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const query = (req as Request & {
      validatedQuery: { q?: string; projectId?: number | null; page: number; pageSize: number };
    }).validatedQuery;
    res.json(await equipmentService.list({ ...query, scope: req.scope }));
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const equipment = await equipmentService.create(req.body, req.user!.id);
    res.status(201).json(equipment);
  } catch (err) {
    next(err);
  }
}

export async function register(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await equipmentService.registerEquipment(req.body, req.user!.id);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const equipment = await equipmentService.update(Number(req.params.id), req.body, req.user!.id);
    res.json(equipment);
  } catch (err) {
    next(err);
  }
}

export async function syncManagers(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await equipmentService.syncFromManagers(req.user!.id));
  } catch (err) {
    next(err);
  }
}

export async function listCategories(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await equipmentService.listCategories());
  } catch (err) {
    next(err);
  }
}

export async function createCategory(req: Request, res: Response, next: NextFunction) {
  try {
    res.status(201).json(await equipmentService.createCategory(req.body, req.user!.id));
  } catch (err) {
    next(err);
  }
}

export async function updateCategory(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(
      await equipmentService.updateCategory(Number(req.params.id), req.body, req.user!.id)
    );
  } catch (err) {
    next(err);
  }
}

export async function removeCategory(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await equipmentService.removeCategory(Number(req.params.id), req.user!.id));
  } catch (err) {
    next(err);
  }
}

export async function trackingReview(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await equipmentService.trackingReview());
  } catch (err) {
    next(err);
  }
}

export async function listAssignments(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await equipmentService.listAssignments(Number(req.params.id)));
  } catch (err) {
    next(err);
  }
}
