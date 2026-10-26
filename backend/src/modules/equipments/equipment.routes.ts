import { Router } from "express";
import * as equipmentController from "./equipment.controller";
import { validate, validateQuery } from "../../middleware/validate.middleware";
import { requireAuth, requireRole } from "../../middleware/auth.middleware";
import {
  createEquipmentSchema,
  updateEquipmentSchema,
  lookupQuerySchema,
  listEquipmentQuerySchema,
  lastMeterQuerySchema,
  createMeterResetSchema,
  createCategorySchema,
  updateCategorySchema,
} from "./equipment.schemas";

const router = Router();

router.use(requireAuth);

router.get("/lookup", validateQuery(lookupQuerySchema), equipmentController.lookup);
router.get("/categories", equipmentController.listCategories);
router.post(
  "/categories",
  requireRole("ROOT", "ADMIN"),
  validate(createCategorySchema),
  equipmentController.createCategory
);
router.put(
  "/categories/:id",
  requireRole("ROOT", "ADMIN"),
  validate(updateCategorySchema),
  equipmentController.updateCategory
);
router.delete(
  "/categories/:id",
  requireRole("ROOT", "ADMIN"),
  equipmentController.removeCategory
);
router.get(
  "/tracking-review",
  requireRole("ROOT", "ADMIN"),
  equipmentController.trackingReview
);
router.get("/", validateQuery(listEquipmentQuerySchema), equipmentController.list);
router.post("/sync-managers", requireRole("ROOT", "ADMIN"), equipmentController.syncManagers);
router.get(
  "/:id/last-meter",
  validateQuery(lastMeterQuerySchema),
  equipmentController.lastMeter
);
router.get("/:id/meter-resets", equipmentController.listMeterResets);
router.post(
  "/:id/meter-resets",
  validate(createMeterResetSchema),
  equipmentController.createMeterReset
);
router.post("/", validate(createEquipmentSchema), equipmentController.create);
router.put("/:id", validate(updateEquipmentSchema), equipmentController.update);

export default router;
