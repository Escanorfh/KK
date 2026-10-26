import { Router } from "express";
import * as needRequestController from "./needRequest.controller";
import { validate, validateQuery } from "../../middleware/validate.middleware";
import { requireAuth } from "../../middleware/auth.middleware";
import {
  createNeedRequestSchema,
  updateNeedRequestSchema,
  listNeedRequestQuerySchema,
} from "./needRequest.schemas";

const router = Router();

router.use(requireAuth);

router.get("/", validateQuery(listNeedRequestQuerySchema), needRequestController.list);
router.post("/", validate(createNeedRequestSchema), needRequestController.create);
router.get("/:id", needRequestController.get);
router.put("/:id", validate(updateNeedRequestSchema), needRequestController.update);
router.post("/:id/send", needRequestController.send);
router.post("/:id/sync", needRequestController.sync);
router.delete("/:id", needRequestController.remove);

export default router;
