import { Router } from "express";
import * as maintenanceController from "./maintenance.controller";
import { validate, validateQuery } from "../../middleware/validate.middleware";
import { requireAuth } from "../../middleware/auth.middleware";
import {
  createMaintenanceSchema,
  updateMaintenanceSchema,
  listMaintenanceQuerySchema,
} from "./maintenance.schemas";

const router = Router();

router.use(requireAuth);

router.get("/", validateQuery(listMaintenanceQuerySchema), maintenanceController.list);
router.get("/all", validateQuery(listMaintenanceQuerySchema), maintenanceController.all);
router.get("/export", validateQuery(listMaintenanceQuerySchema), maintenanceController.exportCsv);
router.post("/", validate(createMaintenanceSchema), maintenanceController.save);
router.put("/:id", validate(updateMaintenanceSchema), maintenanceController.update);
router.delete("/:id", maintenanceController.remove);

export default router;
