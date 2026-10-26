import { Router } from "express";
import * as dailylogController from "./dailylog.controller";
import { validate, validateQuery } from "../../middleware/validate.middleware";
import { requireAuth } from "../../middleware/auth.middleware";
import {
  saveDailyLogSchema,
  updateDailyLogSchema,
  listDailyLogQuerySchema,
} from "./dailylog.schemas";

const router = Router();

router.use(requireAuth);

router.get("/", validateQuery(listDailyLogQuerySchema), dailylogController.list);
router.get("/all", validateQuery(listDailyLogQuerySchema), dailylogController.all);
router.get("/export", validateQuery(listDailyLogQuerySchema), dailylogController.exportCsv);
router.get("/:id", dailylogController.get);
router.post("/", validate(saveDailyLogSchema), dailylogController.save);
router.put("/:id", validate(updateDailyLogSchema), dailylogController.update);

export default router;
