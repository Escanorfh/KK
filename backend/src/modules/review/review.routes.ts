import { Router } from "express";
import * as reviewController from "./review.controller";
import { validate, validateQuery } from "../../middleware/validate.middleware";
import { requireAuth, requireRole } from "../../middleware/auth.middleware";
import { createReviewSchema, listReviewQuerySchema, rejectReviewSchema, updateReviewSchema } from "./review.schemas";

const router = Router();
router.use(requireAuth);

router.get("/", validateQuery(listReviewQuerySchema), reviewController.list);
router.get("/:id", reviewController.get);
router.post("/", validate(createReviewSchema), reviewController.create);
router.put("/:id", requireRole("ROOT", "ADMIN"), validate(updateReviewSchema), reviewController.update);
router.post("/:id/approve", requireRole("ROOT", "ADMIN"), reviewController.approve);
router.post("/:id/reject", requireRole("ROOT", "ADMIN"), validate(rejectReviewSchema), reviewController.reject);

export default router;
