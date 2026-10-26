import { Router } from "express";
import * as dashboardController from "./dashboard.controller";
import { requireAuth } from "../../middleware/auth.middleware";

const router = Router();

router.use(requireAuth);

router.get("/summary", dashboardController.summary);

export default router;
