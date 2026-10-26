import { Router } from "express";
import * as sectorController from "./sector.controller";
import { validate, validateQuery } from "../../middleware/validate.middleware";
import { requireAuth, requireRole } from "../../middleware/auth.middleware";
import { createSectorSchema, updateSectorSchema, listSectorsQuerySchema } from "./sector.schemas";

const router = Router();

router.use(requireAuth);

router.get("/", validateQuery(listSectorsQuerySchema), sectorController.list);
router.post("/", validate(createSectorSchema), sectorController.create);
router.put("/:id", validate(updateSectorSchema), sectorController.update);
router.delete("/:id", requireRole("ROOT", "ADMIN"), sectorController.remove);

export default router;
