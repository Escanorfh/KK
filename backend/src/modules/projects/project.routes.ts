import { Router } from "express";
import * as projectController from "./project.controller";
import { validate, validateQuery } from "../../middleware/validate.middleware";
import { requireAuth, requireRole } from "../../middleware/auth.middleware";
import { createProjectSchema, updateProjectSchema, listProjectsQuerySchema } from "./project.schemas";

const router = Router();

router.use(requireAuth);

router.get("/", validateQuery(listProjectsQuerySchema), projectController.list);
router.get("/options", projectController.options);
router.post("/", validate(createProjectSchema), projectController.create);
router.put("/:id", validate(updateProjectSchema), projectController.update);
router.delete("/:id", requireRole("ROOT", "ADMIN"), projectController.remove);

export default router;
