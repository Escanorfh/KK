import type { Request, Response, NextFunction } from "express";
import * as dataService from "./data.service";
import { withDbRetry, wakeDb } from "../../utils/db";

type EntityParam = { entity: string };

function entityOf(req: Request): dataService.Entity {
  const { entity } = req.params as EntityParam;
  if (!dataService.isEntity(entity)) {
    throw Object.assign(new Error("جدول غير معروف"), { status: 404 });
  }
  return entity;
}

export async function stats(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await withDbRetry(() => dataService.stats()));
  } catch (err) {
    next(err);
  }
}

export async function exportData(req: Request, res: Response, next: NextFunction) {
  try {
    const entity = entityOf(req);
    const { buffer, filename } = await withDbRetry(() => dataService.exportEntity(entity));
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`
    );
    res.send(buffer);
  } catch (err) {
    next(err);
  }
}

export async function importData(req: Request, res: Response, next: NextFunction) {
  try {
    const entity = entityOf(req);
    const file = req.file;
    if (!file) {
      throw Object.assign(new Error("اختر ملف Excel للاستيراد"), { status: 400 });
    }
    const sheetRaw = req.body?.sheet;
    const sheet = typeof sheetRaw === "string" && sheetRaw.trim() ? sheetRaw.trim() : undefined;
    await wakeDb();
    const result = await withDbRetry(() =>
      dataService.importEntity(entity, file.buffer, sheet, file.originalname)
    );
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function clearEntity(req: Request, res: Response, next: NextFunction) {
  try {
    const entity = entityOf(req);
    res.json(await withDbRetry(() => dataService.clearEntity(entity)));
  } catch (err) {
    next(err);
  }
}

export async function clearAll(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await withDbRetry(() => dataService.clearAll()));
  } catch (err) {
    next(err);
  }
}

export async function listImports(_req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await withDbRetry(() => dataService.listImports()));
  } catch (err) {
    next(err);
  }
}

export async function deleteImport(req: Request, res: Response, next: NextFunction) {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      throw Object.assign(new Error("رقم سجل الاستيراد غير صالح"), { status: 400 });
    }
    await wakeDb();
    res.json(await withDbRetry(() => dataService.deleteImport(id)));
  } catch (err) {
    next(err);
  }
}

export async function syncProjects(_req: Request, res: Response, next: NextFunction) {
  try {
    await wakeDb();
    res.json(await withDbRetry(() => dataService.syncProjectsFromManagers()));
  } catch (err) {
    next(err);
  }
}
