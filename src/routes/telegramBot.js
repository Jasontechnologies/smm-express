import TelegramBot from "node-telegram-bot-api";
import axios from "axios";
import dotenv from "dotenv";
import { store } from "../store.js";

dotenv.config();

export default function setupTelegramBot(app) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const url = process.env.HOST_URL; // e.g., https://smm-express.onrender.com

    if (!token || !url) {
        console.warn("⚠️ Telegram bot not configured (missing token or HOST_URL)");
        return;
    }

    const bot = new TelegramBot(token);
    bot.setWebHook(`${url}/bot${token}`);

    // ✅ Webhook route — attached to main app
    app.post(`/bot${token}`, async (req, res) => {
        bot.processUpdate(req.body);
        res.sendStatus(200);
    });

    const userStates = {};

    // --- Commands ---
    bot.onText(/\/start/, (msg) => {
        bot.sendMessage(msg.chat.id,
            "👋 Welcome to Quantum JAP Bot!\n\n" +
            "Use:\n" +
            "• `/order` to place a new order\n" +
            "• `/balance` to check your JAP balance\n" +
            "• `/setkey <your_key>` to set your JAP API key",
            { parse_mode: "Markdown" }
        );
    });

    bot.onText(/\/order/, (msg) => {
        const chatId = msg.chat.id;
        userStates[chatId] = { step: "awaiting_link" };
        bot.sendMessage(chatId, "🔗 Please send the link for your order:");
    });

    bot.on("message", async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text;
        if (text.startsWith("/")) return;
        const state = userStates[chatId];
        if (!state) return;

        if (state.step === "awaiting_link") {
            state.link = text;
            state.step = "awaiting_quantity";
            bot.sendMessage(chatId, "📦 Got it! Now send the *quantity*:", { parse_mode: "Markdown" });
            return;
        }

        if (state.step === "awaiting_quantity") {
            const quantity = parseInt(text);
            if (isNaN(quantity) || quantity <= 0) return bot.sendMessage(chatId, "❗ Please enter a valid number.");
            state.quantity = quantity;
            state.step = "awaiting_confirmation";
            bot.sendMessage(
                chatId,
                `Confirm your order:\n\n🔗 Link: ${state.link}\n📦 Quantity: ${state.quantity}`,
                {
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "✅ Confirm", callback_data: "confirm_order" }],
                            [{ text: "❌ Cancel", callback_data: "cancel_order" }]
                        ]
                    }
                }
            );
        }
    });

    bot.on("callback_query", async (query) => {
        const chatId = query.message.chat.id;
        const data = query.data;
        const state = userStates[chatId];
        if (!state) return bot.answerCallbackQuery(query.id);

        if (data === "cancel_order") {
            delete userStates[chatId];
            bot.sendMessage(chatId, "❌ Order cancelled.");
        } else if (data === "confirm_order") {
            bot.sendMessage(chatId, "⏳ Placing your order...");
            try {
                const response = await axios.post(`${url}/api/jap/order`, {
                    serviceId: process.env.DEFAULT_SERVICE_ID || 1,
                    link: state.link,
                    quantity: state.quantity,
                    chatId
                });
                const { localOrder } = response.data;
                bot.sendMessage(chatId, `✅ Order placed!\n\n🆔 ID: ${localOrder.id}\n📦 Status: ${localOrder.status}`);
            } catch (err) {
                bot.sendMessage(chatId, "❗ Failed to place order. Please try again.");
            }
            delete userStates[chatId];
        }

        bot.answerCallbackQuery(query.id);
    });

    bot.onText(/\/setkey (.+)/, async (msg, match) => {
        const newKey = match[1];
        try {
            await store.setSettings({ japKey: newKey });
            bot.sendMessage(msg.chat.id, "✅ JAP API key updated successfully!");
        } catch {
            bot.sendMessage(msg.chat.id, "❌ Failed to update JAP key.");
        }
    });

    bot.onText(/\/balance/, async (msg) => {
        const chatId = msg.chat.id;
        try {
            const settings = await store.getSettings();
            const key = settings.japKey || process.env.JAP_API_KEY;
            const res = await axios.post(
                "https://justanotherpanel.com/api/v2",
                new URLSearchParams({ key, action: "balance" }).toString(),
                { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
            );
            bot.sendMessage(chatId, `💰 Balance: ${res.data.balance} ${res.data.currency}`);
        } catch {
            bot.sendMessage(chatId, "⚠️ Could not retrieve balance.");
        }
    });

    console.log(`🤖 Telegram bot connected via webhook at ${url}/bot${token}`);
}
