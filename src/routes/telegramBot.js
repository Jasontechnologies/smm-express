import express from "express";
import TelegramBot from "node-telegram-bot-api";
import axios from "axios";
import dotenv from "dotenv";
import { store } from "../store.js";

dotenv.config();

const app = express();
app.use(express.json());

const token = process.env.TELEGRAM_BOT_TOKEN;
const url = process.env.HOST_URL; // e.g., https://yourdomain.com
const port = process.env.PORT || 3000;

// ✅ Create bot in webhook mode
const bot = new TelegramBot(token);
bot.setWebHook(`${url}/bot${token}`);

// ✅ Handle Telegram updates
app.post(`/bot${token}`, async (req, res) => {
    bot.processUpdate(req.body);
    res.sendStatus(200);
});

// Store temporary user states in memory
const userStates = {};

// ==================================================
// COMMAND: /start
// ==================================================
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    bot.sendMessage(
        chatId,
        "👋 *Welcome to Quantum JAP Bot!*\n\nYou can:\n" +
        "• Use `/order` to place a new order\n" +
        "• Use `/balance` to check your JAP balance\n" +
        "• Use `/setkey <your_jap_key>` to update the JAP key",
        { parse_mode: "Markdown" }
    );
});

// ==================================================
// COMMAND: /order (step-by-step flow)
// ==================================================
bot.onText(/\/order/, (msg) => {
    const chatId = msg.chat.id;
    userStates[chatId] = { step: "awaiting_link" };
    bot.sendMessage(chatId, "🔗 Please send the link for your order:");
});

bot.on("message", async (msg) => {
    const chatId = msg.chat.id;
    const text = msg.text;

    // Ignore commands
    if (text.startsWith("/")) return;

    const state = userStates[chatId];
    if (!state) return;

    try {
        // Step 1: Link
        if (state.step === "awaiting_link") {
            state.link = text;
            state.step = "awaiting_quantity";
            bot.sendMessage(chatId, "📦 Got it! Now enter the *quantity*:", { parse_mode: "Markdown" });
            return;
        }

        // Step 2: Quantity
        if (state.step === "awaiting_quantity") {
            const quantity = parseInt(text);
            if (isNaN(quantity) || quantity <= 0) {
                return bot.sendMessage(chatId, "❗ Please enter a valid quantity (number).");
            }
            state.quantity = quantity;
            state.step = "awaiting_confirmation";

            // Step 3: Confirm order
            bot.sendMessage(
                chatId,
                `✅ Please confirm your order:\n\n*Link:* ${state.link}\n*Quantity:* ${state.quantity}`,
                {
                    parse_mode: "Markdown",
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "✅ Confirm", callback_data: "confirm_order" }],
                            [{ text: "❌ Cancel", callback_data: "cancel_order" }],
                        ],
                    },
                }
            );
        }
    } catch (err) {
        console.error("Telegram message error:", err.message);
        bot.sendMessage(chatId, "⚠️ Something went wrong. Please try again.");
    }
});

// ==================================================
// Handle inline button callbacks
// ==================================================
bot.on("callback_query", async (callbackQuery) => {
    const chatId = callbackQuery.message.chat.id;
    const data = callbackQuery.data;
    const state = userStates[chatId];

    if (!state) return bot.answerCallbackQuery(callbackQuery.id);

    if (data === "cancel_order") {
        delete userStates[chatId];
        bot.sendMessage(chatId, "❌ Order cancelled.");
    }

    if (data === "confirm_order") {
        if (!state.link || !state.quantity) {
            return bot.sendMessage(chatId, "⚠️ Missing order details. Please start again with /order.");
        }

        bot.sendMessage(chatId, "⏳ Placing your order, please wait...");

        try {
            // Backend API call
            const response = await axios.post(`${url}/api/jap/order`, {
                serviceId: process.env.DEFAULT_SERVICE_ID || 1,
                link: state.link,
                quantity: state.quantity,
                chatId: chatId,
            });

            const { localOrder } = response.data;
            bot.sendMessage(
                chatId,
                `✅ *Order Placed Successfully!*\n\n🆔 Order ID: ${localOrder.id}\n📦 Status: ${localOrder.status}`,
                { parse_mode: "Markdown" }
            );
        } catch (err) {
            console.error("Order error:", err.response?.data || err.message);
            bot.sendMessage(chatId, "❗ Failed to place order. Please try again later.");
        }

        delete userStates[chatId];
    }

    bot.answerCallbackQuery(callbackQuery.id);
});

// ==================================================
// COMMAND: /setkey <your_key>
// ==================================================
bot.onText(/\/setkey (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const newKey = match[1]?.trim();

    if (!newKey || newKey.length < 10) {
        return bot.sendMessage(chatId, "⚠️ Please provide a valid JAP API key.\n\nExample:\n`/setkey your_jap_key_here`", {
            parse_mode: "Markdown",
        });
    }

    try {
        await store.setSettings({ japKey: newKey });
        bot.sendMessage(chatId, "✅ JAP API key updated successfully!");
    } catch (err) {
        console.error("Set key error:", err.message);
        bot.sendMessage(chatId, "❗ Failed to update JAP API key. Please try again.");
    }
});

// ==================================================
// COMMAND: /balance (check JAP balance instantly)
// ==================================================
bot.onText(/\/balance/, async (msg) => {
    const chatId = msg.chat.id;

    try {
        const settings = await store.getSettings();
        const key = settings.japKey || process.env.JAP_API_KEY;

        const balanceRes = await axios.post("https://justanotherpanel.com/api/v2", new URLSearchParams({
            key,
            action: "balance",
        }).toString(), {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
        });

        const balance = balanceRes.data.balance || "0.00";
        const currency = balanceRes.data.currency || "USD";

        bot.sendMessage(chatId, `💰 *Your JAP Balance:*\n${balance} ${currency}`, {
            parse_mode: "Markdown",
        });
    } catch (err) {
        console.error("Balance check error:", err.message);
        bot.sendMessage(chatId, "❗ Failed to fetch JAP balance.");
    }
});

// ==================================================
// Notify function: used by backend when status changes
// ==================================================
export async function notifyOrderStatus(order) {
    if (!order.chatId) return;
    const msg = `📢 *Order Update*\n\n🆔 Order #${order.id}\n📦 Status: *${order.status.toUpperCase()}*`;
    try {
        await bot.sendMessage(order.chatId, msg, { parse_mode: "Markdown" });
    } catch (err) {
        console.error("Telegram notify error:", err.message);
    }
}

// ==================================================
// Start Express server for webhook
// ==================================================
app.listen(port, () => {
    console.log(`🚀 Telegram Bot server running on port ${port}`);
    console.log(`🌐 Webhook set at ${url}/bot${token}`);
});
