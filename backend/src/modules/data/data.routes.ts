import { Router } from "express";
import multer from "multer";
import * as dataController from "./data.controller";
import { requireAuth, requireRole } from "../../middleware/auth.middleware";

const router = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 25 * 1024 * 1024 },
});

router.use(requireAuth, requireRole("ROOT"));

router.get("/stats", dataController.stats);
router.get("/imports", dataController.listImports);
router.get("/export/:entity", dataController.exportData);
router.post("/import/:entity", upload.single("file"), dataController.importData);
router.post("/sync-projects", dataController.syncProjects);
router.delete("/imports/:id", dataController.deleteImport);
router.post("/clear/:entity", dataController.clearEntity);
router.post("/clear-all", dataController.clearAll);

export default router;
