import type { Request, Response, NextFunction } from "express";
import * as authService from "./auth.service";

export async function login(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, password } = req.body;
    const result = await authService.login(name, password);
    res.json(result);
  } catch (err) {
    next(err);
  }
}

export async function me(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await authService.getMe(req.user!.id);
    res.json(user);
  } catch (err) {
    next(err);
  }
}

export async function changePassword(req: Request, res: Response, next: NextFunction) {
  try {
    const { currentPassword, newPassword } = req.body;
    const result = await authService.changePassword(req.user!.id, currentPassword, newPassword);
    res.json(result);
  } catch (err) {
    next(err);
  }
}
