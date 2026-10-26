import type { Request, Response, NextFunction } from "express";
import * as userService from "./user.service";

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const { q } = (req as Request & { validatedQuery: { q?: string } }).validatedQuery;
    res.json({ data: await userService.list(q) });
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await userService.create(req.body, req.user!.id);
    res.status(201).json({ user });
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await userService.update(Number(req.params.id), req.body, req.user!.id);
    res.json({ user });
  } catch (err) {
    next(err);
  }
}

export async function remove(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await userService.remove(Number(req.params.id), req.user!.id));
  } catch (err) {
    next(err);
  }
}
