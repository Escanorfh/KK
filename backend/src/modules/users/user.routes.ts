import { Router } from "express";
import * as userController from "./user.controller";
import { validate, validateQuery } from "../../middleware/validate.middleware";
import { requireAuth, requireRole } from "../../middleware/auth.middleware";
import { createUserSchema, updateUserSchema, listUsersQuerySchema } from "./user.schemas";

const router = Router();

router.use(requireAuth, requireRole("ROOT", "ADMIN"));

router.get("/", validateQuery(listUsersQuerySchema), userController.list);
router.post("/", validate(createUserSchema), userController.create);
router.put("/:id", validate(updateUserSchema), userController.update);
router.delete("/:id", userController.remove);

export default router;
