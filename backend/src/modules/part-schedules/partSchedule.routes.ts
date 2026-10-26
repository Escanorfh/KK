import { Router } from "express";
import * as partScheduleController from "./partSchedule.controller";
import { validate, validateQuery } from "../../middleware/validate.middleware";
import { requireAuth } from "../../middleware/auth.middleware";
import {
  createPartScheduleSchema,
  updatePartScheduleSchema,
  listPartScheduleQuerySchema,
  alertsQuerySchema,
} from "./partSchedule.schemas";

const router = Router();

router.use(requireAuth);

router.get("/alerts", validateQuery(alertsQuerySchema), partScheduleController.alerts);
router.get("/parts", partScheduleController.parts);
router.get("/", validateQuery(listPartScheduleQuerySchema), partScheduleController.list);
router.post("/", validate(createPartScheduleSchema), partScheduleController.save);
router.put("/:id", validate(updatePartScheduleSchema), partScheduleController.update);
router.delete("/:id", partScheduleController.remove);

export default router;
