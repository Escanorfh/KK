import { Router } from "express";
import * as authController from "./auth.controller";
import { validate } from "../../middleware/validate.middleware";
import { requireAuth } from "../../middleware/auth.middleware";
import { loginSchema, changePasswordSchema } from "./auth.schemas";

const router = Router();

router.post("/login", validate(loginSchema), authController.login);
router.get("/me", requireAuth, authController.me);
router.put(
  "/change-password",
  requireAuth,
  validate(changePasswordSchema),
  authController.changePassword
);

export default router;
