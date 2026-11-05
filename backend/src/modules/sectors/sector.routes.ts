import { Router } from "express";
import * as sectorController from "./sector.controller";
import { validate, validateQuery } from "../../middleware/validate.middleware";
import { requireAuth, requireRole } from "../../middleware/auth.middleware";
import {
  createSectorSchema,
  updateSectorSchema,
  listSectorsQuerySchema,
  linkManagersRoomSchema,
  managersRoomsQuerySchema,
} from "./sector.schemas";

const router = Router();

router.use(requireAuth);

// قبل /:id عشان «managers-rooms» ما يتفسّرش كمعرّف قطاع
router.get("/managers-rooms", validateQuery(managersRoomsQuerySchema), sectorController.managersRooms);
router.get("/", validateQuery(listSectorsQuerySchema), sectorController.list);
router.post("/", validate(createSectorSchema), sectorController.create);
router.put("/:id", validate(updateSectorSchema), sectorController.update);
router.put(
  "/:id/managers-room",
  requireRole("ROOT", "ADMIN"),
  validate(linkManagersRoomSchema),
  sectorController.linkManagersRoom
);
router.delete("/:id", requireRole("ROOT", "ADMIN"), sectorController.remove);

export default router;
