import type { Request, Response, NextFunction } from "express";
import * as needRequestService from "./needRequest.service";
import { withDbRetry, wakeDb } from "../../utils/db";
import type { NeedRequestStatus } from "@prisma/client";

type ListQuery = {
  q?: string;
  status?: NeedRequestStatus;
  projectId?: number;
  page: number;
  pageSize: number;
};

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await withDbRetry(() => needRequestService.create(req.body, req.user!.id));
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const query = (req as Request & { validatedQuery: ListQuery }).validatedQuery;
    res.json(await withDbRetry(() => needRequestService.list({ ...query, scope: req.scope })));
  } catch (err) {
    next(err);
  }
}

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    await wakeDb();
    res.json(await withDbRetry(() => needRequestService.get(Number(req.params.id))));
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await withDbRetry(() => needRequestService.update(Number(req.params.id), req.body, req.user!.id));
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function send(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await withDbRetry(() => needRequestService.send(Number(req.params.id), req.user!.id));
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function sync(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await withDbRetry(() => needRequestService.sync(Number(req.params.id), req.user!.id));
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await withDbRetry(() => needRequestService.remove(Number(req.params.id), req.user!.id)));
  } catch (err) {
    next(err);
  }
}
