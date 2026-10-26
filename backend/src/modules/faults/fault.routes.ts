import { Router } from "express";
import * as faultController from "./fault.controller";
import { validate, validateQuery } from "../../middleware/validate.middleware";
import { requireAuth } from "../../middleware/auth.middleware";
import { createFaultSchema, updateFaultSchema, listFaultQuerySchema, faultReportQuerySchema } from "./fault.schemas";

const router = Router();

router.use(requireAuth);

router.get("/report", validateQuery(faultReportQuerySchema), faultController.report);
router.get("/", validateQuery(listFaultQuerySchema), faultController.list);
router.post("/", validate(createFaultSchema), faultController.save);
router.put("/:id", validate(updateFaultSchema), faultController.update);
router.delete("/:id", faultController.remove);

export default router;
