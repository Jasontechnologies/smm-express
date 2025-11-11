import jwt from "jsonwebtoken";
import dotenv from "dotenv";
dotenv.config();

/**
 * ✅ Middleware: requireAuth
 * Authorizes either:
 *  - A normal user using JWT
 *  - The Telegram bot using BOT_JWT (set in Render)
 */
export function requireAuth(req, res, next) {
    const auth = req.headers.authorization;
    const botJwt = process.env.BOT_JWT;

    // ✅ 1. Allow the Telegram bot if it uses BOT_JWT
    if (auth && auth === `Bearer ${botJwt}`) {
        req.user = { id: "bot", email: "bot@system.local", role: "bot" };
        return next();
    }

    // ✅ 2. Standard user authentication
    if (!auth) return res.status(401).json({ error: "Unauthorized" });
    const token = auth.split(" ")[1];

    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET || "secret");
        req.user = payload;
        next();
    } catch (err) {
        return res.status(401).json({ error: "Unauthorized" });
    }
}
