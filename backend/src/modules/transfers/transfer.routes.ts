import { Router } from "express";
import * as c from "./transfer.controller";
import { validate, validateQuery } from "../../middleware/validate.middleware";
import { requireAuth, requireRole } from "../../middleware/auth.middleware";
import { createTransferSchema, listTransferQuerySchema, rejectTransferSchema, approveTransferSchema } from "./transfer.schemas";

const r = Router();
r.use(requireAuth);
r.get("/stats", c.stats);
r.get("/", validateQuery(listTransferQuerySchema), c.list);
r.get("/:id", c.get);
r.post("/", validate(createTransferSchema), c.create);
r.post("/:id/approve", requireRole("ROOT", "ADMIN"), validate(approveTransferSchema), c.approve);
r.post("/:id/reject", requireRole("ROOT", "ADMIN"), validate(rejectTransferSchema), c.reject);
r.post("/:id/cancel", c.cancel);
export default r;
