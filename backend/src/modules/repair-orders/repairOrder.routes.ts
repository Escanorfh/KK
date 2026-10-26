import { Router } from "express";
import * as repairOrderController from "./repairOrder.controller";
import { validate, validateQuery } from "../../middleware/validate.middleware";
import { requireAuth } from "../../middleware/auth.middleware";
import {
  createRepairOrderSchema,
  updateRepairOrderSchema,
  statusSchema,
  listRepairOrderQuerySchema,
} from "./repairOrder.schemas";

const router = Router();

router.use(requireAuth);

router.get("/", validateQuery(listRepairOrderQuerySchema), repairOrderController.list);
router.post("/", validate(createRepairOrderSchema), repairOrderController.create);
router.get("/:id", repairOrderController.get);
router.put("/:id", validate(updateRepairOrderSchema), repairOrderController.update);
router.post("/:id/status", validate(statusSchema), repairOrderController.changeStatus);
router.post("/:id/send", repairOrderController.send);
router.post("/:id/sync", repairOrderController.sync);
router.delete("/:id", repairOrderController.remove);

export default router;
