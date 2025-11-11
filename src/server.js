import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { initStore } from "./store.js";
import authRoutes from "./routes/auth.js";
import japRoutes from "./routes/jap.js";
import settingsRoutes from "./routes/settings.js";
import { setupTelegramBot } from "./routes/telegramBot.js"; // ✅ updated import

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
const allowedOrigins = [
    "http://localhost:5173",
    "https://smm-react-six.vercel.app"
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

async function startServer() {
    try {
        console.log("⏳ Connecting to MongoDB...");
        await initStore();
        console.log("✅ MongoDB connection successful");

        // Routes
        app.use("/api/auth", authRoutes);
        app.use("/api/jap", japRoutes);
        app.use("/api/settings", settingsRoutes);

        app.get("/", (req, res) => {
            res.status(200).json({
                ok: true,
                message: "Quantum JAP Backend is running ✅",
                timestamp: new Date().toISOString(),
            });
        });

        app.get("/health", (req, res) => res.sendStatus(200));

        // ✅ Initialize Telegram bot webhook
        if (process.env.TELEGRAM_BOT_TOKEN && process.env.HOST_URL) {
            console.log("🤖 Initializing Telegram Bot...");
            setupTelegramBot(app); // <-- integrates bot webhook directly into same app
        } else {
            console.warn("⚠️ Telegram bot not initialized: missing token or host URL.");
        }

        // Start server
        app.listen(PORT, () => {
            console.log(`✅ Server running on port ${PORT}`);
            console.log("🌍 Ready for requests");
            console.log("📡 Watching for Telegram messages...");
        });

    } catch (err) {
        console.error("❌ Failed to start server:", err);
        process.exit(1);
    }
}

startServer();
