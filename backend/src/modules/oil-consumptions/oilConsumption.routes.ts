import { Router } from "express";
import * as oilConsumptionController from "./oilConsumption.controller";
import { validate, validateQuery } from "../../middleware/validate.middleware";
import { requireAuth } from "../../middleware/auth.middleware";
import {
  createOilConsumptionSchema,
  updateOilConsumptionSchema,
  listOilConsumptionQuerySchema,
  oilConsumptionSummaryQuerySchema,
} from "./oilConsumption.schemas";

const router = Router();

router.use(requireAuth);

router.get("/summary", validateQuery(oilConsumptionSummaryQuerySchema), oilConsumptionController.summary);
router.post("/sync", oilConsumptionController.sync);
router.get("/", validateQuery(listOilConsumptionQuerySchema), oilConsumptionController.list);
router.post("/", validate(createOilConsumptionSchema), oilConsumptionController.create);
router.put("/:id", validate(updateOilConsumptionSchema), oilConsumptionController.update);
router.delete("/:id", oilConsumptionController.remove);

export default router;
