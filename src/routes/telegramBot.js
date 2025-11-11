import express from "express";
import TelegramBot from "node-telegram-bot-api";
import axios from "axios";
import dotenv from "dotenv";
import { store } from "../store.js";
import { fetchServices } from "../japClient.js";

dotenv.config();

const app = express();
app.use(express.json());

const token = process.env.TELEGRAM_BOT_TOKEN;
const url = process.env.HOST_URL; // e.g., https://smm-express.onrender.com
const port = process.env.PORT || 3000;

const bot = new TelegramBot(token);
bot.setWebHook(`${url}/bot${token}`);

app.post(`/bot${token}`, async (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// Temporary in-memory user session
const userStates = {};

// 🟢 /start command
bot.onText(/\/start/, (msg) => {
    bot.sendMessage(
        msg.chat.id,
        "👋 *Welcome to Quantum JAP Bot!*\n\nYou can:\n• `/order` to place a new order\n• `/balance` to check your balance\n• `/setkey <your_jap_key>` to set your JAP API key",
        { parse_mode: "Markdown" }
    );
});

// 🟢 /balance command
bot.onText(/\/balance/, async (msg) => {
    const chatId = msg.chat.id;
    try {
        const settings = await store.getSettings();
        const key = settings.japKey || process.env.JAP_API_KEY;

        const res = await axios.post("https://justanotherpanel.com/api/v2", new URLSearchParams({
            key,
            action: "balance"
        }).toString(), { headers: { "Content-Type": "application/x-www-form-urlencoded" } });

        bot.sendMessage(chatId, `💰 *Balance:* ${res.data.balance} ${res.data.currency}`, { parse_mode: "Markdown" });
    } catch (err) {
        bot.sendMessage(chatId, "❗ Failed to fetch balance. Check your JAP key.");
    }
});

// 🟢 /setkey command
bot.onText(/\/setkey (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const newKey = match[1]?.trim();

    if (!newKey) {
        return bot.sendMessage(chatId, "⚠️ Usage: `/setkey your_jap_key_here`", { parse_mode: "Markdown" });
    }

    try {
        await store.setSettings({ japKey: newKey });
        bot.sendMessage(chatId, "✅ JAP API key saved successfully!");
    } catch (err) {
        bot.sendMessage(chatId, "❗ Failed to save JAP key.");
    }
});

// 🟢 /order command — interactive service selection
bot.onText(/\/order/, async (msg) => {
    const chatId = msg.chat.id;

    try {
        const settings = await store.getSettings();
        const key = settings.japKey || process.env.JAP_API_KEY;

        bot.sendMessage(chatId, "📦 Fetching available Twitter services...");

        const services = await fetchServices(key);

        if (!services.length) {
            return bot.sendMessage(chatId, "❗ No services found. Please check your JAP key.");
        }

        // Create inline keyboard of services
        const inlineKeyboard = services.slice(0, 10).map(s => [
            { text: s.name.slice(0, 40), callback_data: `select_service_${s.service}` }
        ]);

        userStates[chatId] = { step: "selecting_service", services };

        bot.sendMessage(chatId, "👇 Select a service to continue:", {
            reply_markup: { inline_keyboard: inlineKeyboard }
        });

    } catch (err) {
        console.error("Service fetch error:", err.message);
        bot.sendMessage(chatId, "❗ Failed to fetch JAP services.");
    }
});

// 🟢 Handle button interactions
bot.on("callback_query", async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    const state = userStates[chatId];

    try {
        // --- Service selected ---
        if (data.startsWith("select_service_")) {
            const serviceId = data.replace("select_service_", "");
            const service = state.services.find(s => String(s.service) === serviceId);
            state.service = service;
            state.step = "awaiting_link";

            bot.sendMessage(chatId, `✅ Selected: *${service.name}*\n\n🔗 Now send the link for your order:`, {
                parse_mode: "Markdown"
            });
        }

        // --- Cancel or confirm order ---
        if (data === "cancel_order") {
            delete userStates[chatId];
            bot.sendMessage(chatId, "❌ Order cancelled.");
        }

        if (data === "confirm_order") {
            if (!state.link || !state.quantity || !state.service) {
                return bot.sendMessage(chatId, "⚠️ Missing details. Please restart with /order");
            }

            bot.sendMessage(chatId, "⏳ Placing your order...");

            try {
                const response = await axios.post(`${url}/api/jap/order`, {
                    serviceId: state.service.service,
                    link: state.link,
                    quantity: state.quantity,
                    chatId: chatId
                });

                const { localOrder } = response.data;
                bot.sendMessage(chatId, `✅ *Order placed successfully!*\n\n🆔 ID: ${localOrder.id}\n📦 Status: ${localOrder.status}`, {
                    parse_mode: "Markdown"
                });
            } catch (err) {
                bot.sendMessage(chatId, "❗ Failed to place the order. Please try again.");
            }

            delete userStates[chatId];
        }

        bot.answerCallbackQuery(callbackQuery.id);
    } catch (err) {
        console.error("Callback error:", err.message);
        bot.answerCallbackQuery(callbackQuery.id);
    }
});

// 🟢 Handle messages (link → quantity → confirm)
bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;
    if (text.startsWith("/")) return; // skip commands
    const state = userStates[chatId];
    if (!state) return;

    try {
        if (state.step === "awaiting_link") {
            state.link = text;
            state.step = "awaiting_quantity";
            bot.sendMessage(chatId, "📊 Great! Now enter the *quantity*:", { parse_mode: "Markdown" });
            return;
        }

        if (state.step === "awaiting_quantity") {
            const quantity = parseInt(text);
            if (isNaN(quantity) || quantity <= 0) {
                return bot.sendMessage(chatId, "⚠️ Please enter a valid number.");
            }
            state.quantity = quantity;
            state.step = "confirming";

            bot.sendMessage(chatId, `🧾 *Confirm your order:*\n\n🛠 Service: ${state.service.name}\n🔗 Link: ${state.link}\n📦 Quantity: ${state.quantity}`, {
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "✅ Confirm", callback_data: "confirm_order" }],
                        [{ text: "❌ Cancel", callback_data: "cancel_order" }]
                    ]
                }
            });
        }
    } catch (err) {
        console.error("Message handling error:", err.message);
    }
});

// 🟢 Notify order status (used by backend)
export async function notifyOrderStatus(order) {
    if (!order.chatId) return;
    const msg = `📢 *Order Update*\n\n🆔 Order #${order.id}\n📦 Status: *${order.status.toUpperCase()}*`;
    try {
        await bot.sendMessage(order.chatId, msg, { parse_mode: "Markdown" });
    } catch (err) {
        console.error("Telegram notify error:", err.message);
    }
}

// 🟢 Start Express server for webhook
app.listen(port, () => {
    console.log(`🚀 Telegram Bot server running on port ${port}`);
    console.log(`🌐 Webhook set at ${url}/bot${token}`);
});

export default app;
