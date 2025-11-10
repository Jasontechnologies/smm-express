import express from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import { store } from "../store.js";

const router = express.Router();

/**
 * GET /api/settings
 * Returns all stored settings (e.g. JAP API key)
 */
router.get("/", requireAuth, async (req, res) => {
    try {
        const settings = await store.getSettings();
        res.json({ settings });
    } catch (err) {
        console.error("Settings fetch error:", err.message);
        res.status(500).json({ error: "Failed to load settings" });
    }
});

/**
 * PUT /api/settings/jap-key
 * Updates the JAP API key (used by JAP client)
 * Requires authentication
 */
router.put("/jap-key", requireAuth, async (req, res) => {
    try {
        const { japKey } = req.body;

        // ✅ Validate input
        if (!japKey || typeof japKey !== "string" || japKey.trim().length < 10) {
            return res.status(400).json({ error: "Invalid JAP API key" });
        }

        // ✅ Save JAP key in database (via store)
        await store.setSettings({ japKey: japKey.trim() });

        res.json({ ok: true, message: "JAP API key updated successfully" });
    } catch (err) {
        console.error("Error updating JAP key:", err.message);
        res.status(500).json({ error: "Failed to update JAP key" });
    }
});

export default router;
