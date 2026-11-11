import type { Request, Response, NextFunction } from "express";
import * as reviewService from "./review.service";

export async function list(req: Request, res: Response, next: NextFunction) {
  try {
    const q = (req as Request & { validatedQuery: Record<string, unknown> }).validatedQuery;
    res.json(
      await reviewService.list(
        q as { page: number; pageSize: number; entity?: "dailylog" | "maintenance"; status?: "PENDING_REVIEW" | "APPROVED" | "REJECTED"; submittedBy?: number },
        req.user!,
      ),
    );
  } catch (err) {
    next(err);
  }
}

export async function get(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await reviewService.get(Number(req.params.id), req.user!));
  } catch (err) {
    next(err);
  }
}

export async function create(req: Request, res: Response, next: NextFunction) {
  try {
    const result = await reviewService.createReviewRequest(req.body, req.user!.id);
    res.status(202).json({ ...result, pendingReview: true });
  } catch (err) {
    next(err);
  }
}

export async function update(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await reviewService.update(Number(req.params.id), req.body, req.user!.id, req.user!.role));
  } catch (err) {
    next(err);
  }
}

export async function approve(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await reviewService.approve(Number(req.params.id), req.user!.id));
  } catch (err) {
    next(err);
  }
}

export async function reject(req: Request, res: Response, next: NextFunction) {
  try {
    res.json(await reviewService.reject(Number(req.params.id), req.user!.id, req.body.reason));
  } catch (err) {
    next(err);
  }
}
