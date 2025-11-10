import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { initStore } from "./store.js";
import authRoutes from "./routes/auth.js";
import japRoutes from "./routes/jap.js";
import settingsRoutes from "./routes/settings.js";
import bot from "./telegram/telegramBot.js"; // optional: only if you already integrated Telegram bot

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// -------------------------------------
// 🧩 1. Middleware Setup
// -------------------------------------
const allowedOrigins = [
    "http://localhost:5173", // local dev (React)
    "https://your-frontend.vercel.app", // your production frontend
];

app.use(
    cors({
        origin: (origin, callback) => {
            if (!origin || allowedOrigins.includes(origin)) {
                callback(null, true);
            } else {
                callback(new Error("Not allowed by CORS"));
            }
        },
        credentials: true,
    })
);

app.use(express.json());

// -------------------------------------
// 🗄️ 2. Database Initialization
// -------------------------------------
async function startServer() {
    try {
        console.log("⏳ Connecting to MongoDB...");
        await initStore();
        console.log("✅ MongoDB connection successful");

        // -------------------------------------
        // 🚀 3. Route Registration
        // -------------------------------------
        app.use("/api/auth", authRoutes);
        app.use("/api/jap", japRoutes);
        app.use("/api/settings", settingsRoutes);

        // Base route
        app.get("/", (req, res) => {
            res.status(200).send({
                ok: true,
                message: "Quantum JAP Backend is running ✅",
                timestamp: new Date().toISOString(),
            });
        });

        // Health check endpoint (for Render uptime checks)
        app.get("/health", (req, res) => res.sendStatus(200));

        // -------------------------------------
        // 🤖 4. Telegram Bot Webhook (optional)
        // -------------------------------------
        // If you’re running webhook mode, ensure this runs after Express starts
        if (process.env.TELEGRAM_BOT_TOKEN && process.env.HOST_URL) {
            console.log("🤖 Telegram Bot is initialized.");
            // The bot file handles webhook setup internally
        } else {
            console.warn("⚠️ Telegram bot not initialized: missing token or host URL.");
        }

        // -------------------------------------
        // 🟢 5. Start Server
        // -------------------------------------
        app.listen(PORT, () => {
            console.log(`✅ Server running at http://localhost:${PORT}`);
            console.log(`🌍 Ready for requests on port ${PORT}`);
        });

        // Handle graceful shutdown
        process.on("SIGTERM", () => {
            console.log("🧹 Shutting down gracefully...");
            process.exit(0);
        });
    } catch (err) {
        console.error("❌ Failed to start server:", err);
        process.exit(1);
    }
}

startServer();
