import express from "express";
import { requireAuth } from "../middleware/authMiddleware.js";
import * as jap from "../japClient.js";
import { store } from "../store.js";

const router = express.Router();

// In-memory service cache to reduce JAP API load
let servicesCache = { ts: 0, data: [] };
const SERVICES_TTL = 15 * 60 * 1000; // 15 minutes

// ========================================================
// GET /api/jap/services
// ========================================================
router.get("/services", requireAuth, async (req, res) => {
    try {
        // Return from cache if still fresh
        if (Date.now() - servicesCache.ts < SERVICES_TTL && servicesCache.data.length) {
            return res.json({ fromCache: true, services: servicesCache.data });
        }

        // Fetch JAP API key from DB or .env
        const settings = await store.getSettings();
        const key = settings.japKey || process.env.JAP_API_KEY;

        // Fetch services from JAP API
        const data = await jap.fetchServices(key);
        servicesCache = { ts: Date.now(), data };

        if (!data || data.length === 0) {
            return res.status(204).json({ services: [] });
        }

        res.json({ services: data });
    } catch (err) {
        console.error("services err:", err.message);
        res.status(502).json({ error: "Failed to fetch services from JAP", detail: err.message });
    }
});

// ========================================================
// GET /api/jap/balance
// ========================================================
router.get("/balance", requireAuth, async (req, res) => {
    try {
        const settings = await store.getSettings();
        const key = settings.japKey || process.env.JAP_API_KEY;
        const data = await jap.getBalance(key);
        res.json({ balance: data });
    } catch (err) {
        res.status(502).json({ error: "Failed to get balance", detail: err.message });
    }
});

// ========================================================
// POST /api/jap/order
// ========================================================
router.post("/order", requireAuth, async (req, res) => {
    try {
        const { serviceId, link, quantity, runs, interval, chatId } = req.body;
        const settings = await store.getSettings();
        const key = settings.japKey || process.env.JAP_API_KEY;

        // Create new order record
        let localOrder = await store.saveOrder({
            createdAt: new Date().toISOString(),
            serviceId,
            link,
            quantity,
            status: "placing",
            chatId: chatId || null,
        });

        try {
            // Place order on JAP
            const japResponse = await jap.addOrder(key, { service: serviceId, link, quantity, runs, interval });

            // Map JAP status to internal status
            localOrder.japOrderId = japResponse.order;
            localOrder.status = jap.mapJapStatus(japResponse.status || "processing");
            localOrder.updatedAt = new Date().toISOString();

            // Update in DB
            localOrder = await store.saveOrder(localOrder);

            return res.json({ localOrder, japResponse });
        } catch (err) {
            console.error("Order placement error:", err.message);

            localOrder.status = "error";
            localOrder.error = err.message;
            localOrder.updatedAt = new Date().toISOString();

            await store.saveOrder(localOrder);

            return res.status(502).json({ error: "JAP order failed", detail: err.message, localOrder });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ========================================================
// GET /api/jap/order/:id
// ========================================================
router.get("/order/:id", requireAuth, async (req, res) => {
    try {
        const orderId = req.params.id;
        const orders = await store.getOrders();
        const local = orders.find(
            (o) => o.id === orderId || String(o.japOrderId) === String(orderId)
        );
        if (!local) return res.status(404).json({ error: "Order not found" });

        // If JAP order ID not available, return local copy
        if (!local.japOrderId) return res.json({ local });

        const settings = await store.getSettings();
        const key = settings.japKey || process.env.JAP_API_KEY;
        const status = await jap.getOrderStatus(key, local.japOrderId);

        return res.json({ local, status });
    } catch (err) {
        res.status(502).json({ error: err.message });
    }
});

// ========================================================
// GET /api/jap/orders
// ========================================================
router.get("/orders", requireAuth, async (req, res) => {
    try {
        let orders = await store.getOrders();

        // Deduplicate by JAP order ID, keeping most recent
        const uniqueOrders = [];
        const seenJapOrderIds = new Set();
        orders.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

        for (const order of orders) {
            if (order.japOrderId) {
                if (!seenJapOrderIds.has(order.japOrderId)) {
                    seenJapOrderIds.add(order.japOrderId);
                    uniqueOrders.push(order);
                }
            } else {
                uniqueOrders.push(order);
            }
        }
        orders = uniqueOrders;

        // Find orders that need status sync
        const ordersToSync = orders.filter(
            (order) =>
                order.japOrderId &&
                ["placing", "in progress", "pending", "partial"].includes(order.status)
        );

        if (ordersToSync.length > 0) {
            const settings = await store.getSettings();
            const key = settings.japKey || process.env.JAP_API_KEY;

            // Sync all in parallel
            const syncResults = await Promise.allSettled(
                ordersToSync.map(async (order) => {
                    try {
                        const japStatus = await jap.getOrderStatus(key, order.japOrderId);
                        const newStatus = jap.mapJapStatus(japStatus.status);

                        // Track completed time
                        if (newStatus === "completed" && order.status !== "completed") {
                            order.completedAt = new Date().toISOString();
                        }

                        if (newStatus !== order.status) {
                            order.status = newStatus;
                            order.japData = japStatus;
                            order.updatedAt = new Date().toISOString();
                            await store.saveOrder(order);
                        }
                    } catch (err) {
                        console.error(`Sync failed for ${order.japOrderId}:`, err.message);
                        order.syncAttempts = (order.syncAttempts || 0) + 1;
                        if (order.syncAttempts > 3) {
                            order.status = "error";
                            order.error = `Sync failed after ${order.syncAttempts} attempts`;
                        }
                        await store.saveOrder(order);
                    }
                })
            );

            console.log(`Synced ${syncResults.length} orders`);
            orders = await store.getOrders(); // reload fresh data
        }

        // Return latest list
        res.json({ orders });
    } catch (err) {
        console.error("Orders sync error:", err);
        const fallbackOrders = await store.getOrders();
        res.json({ orders: fallbackOrders });
    }
});

export default router;
