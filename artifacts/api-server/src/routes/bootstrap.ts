import { Router, type IRouter, type Request, type Response } from "express";
import { requireOwner } from "../middlewares/auth";
import { completeBootstrapSetup, loadBootstrapStatus } from "../lib/bootstrap";

const router: IRouter = Router();

router.get("/bootstrap-status", async (req: Request, res: Response) => {
  try {
    const status = await loadBootstrapStatus(req.currentUser ?? null);
    return res.json(status);
  } catch (error) {
    console.error("Failed to load bootstrap status:", error);
    return res.status(500).json({ error: "Server error" });
  }
});

router.post("/bootstrap/complete", requireOwner, async (req: Request, res: Response) => {
  try {
    const status = await completeBootstrapSetup(req.currentUser!.id);
    return res.json(status);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Server error";
    const statusCode = message === "Server error" ? 500 : 400;
    return res.status(statusCode).json({ error: message });
  }
});

export default router;
