import { Router } from "express";
import * as c from "./transfer.controller";
import { requireAuth, requireRole } from "../../middleware/auth.middleware";

const router = Router();
router.use(requireAuth);
router.get("/", c.list);
router.get("/:id", c.get);
router.post("/", requireRole("ROOT", "ADMIN"), c.create);
router.post("/:id/complete", requireRole("ROOT", "ADMIN"), c.complete);
router.post("/:id/reject", requireRole("ROOT", "ADMIN"), c.reject);
router.post("/:id/cancel", c.cancel);
export default router;
