import TelegramBot from "node-telegram-bot-api";
import axios from "axios";
import dotenv from "dotenv";
import { store } from "../store.js";
import { fetchServices } from "../japClient.js";

dotenv.config();

let bot; // global reference for notifications

export function setupTelegramBot(app) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const url = process.env.HOST_URL;
    const botJwt = process.env.BOT_JWT;

    if (!token || !url) {
        console.warn("⚠️ Missing TELEGRAM_BOT_TOKEN or HOST_URL — skipping Telegram setup.");
        return;
    }

    // ✅ Initialize Telegram bot in webhook mode
    bot = new TelegramBot(token);
    bot.setWebHook(`${url}/bot${token}`);
    console.log(`🌐 Telegram webhook set at ${url}/bot${token}`);

    // ✅ Webhook handler
    app.post(`/bot${token}`, (req, res) => {
        console.log("📩 Telegram update received");
        bot.processUpdate(req.body);
        res.sendStatus(200);
    });

    const userStates = {};

    // =====================================================
    // 🟢 /start
    // =====================================================
    bot.onText(/\/start/, (msg) => {
        const chatId = msg.chat.id;
        bot.sendMessage(
            chatId,
            "👋 *Welcome to Quantum JAP Bot!*\n\nUse the commands below:\n" +
            "• `/order` — Place a new JAP order\n" +
            "• `/balance` — Check JAP balance\n" +
            "• `/setkey <your_api_key>` — Save JAP API key",
            { parse_mode: "Markdown" }
        );
    });

    // =====================================================
    // 🟢 /setkey
    // =====================================================
    bot.onText(/\/setkey (.+)/, async (msg, match) => {
        const chatId = msg.chat.id;
        const newKey = match[1]?.trim();

        if (!newKey || newKey.length < 10) {
            return bot.sendMessage(
                chatId,
                "⚠️ Please provide a valid JAP API key.\n\nExample:\n`/setkey your_jap_key_here`",
                { parse_mode: "Markdown" }
            );
        }

        try {
            await store.setSettings({ japKey: newKey });
            bot.sendMessage(chatId, "✅ JAP API key saved successfully!");
        } catch (err) {
            console.error("Set key error:", err.message);
            bot.sendMessage(chatId, "❗️ Failed to save JAP key.");
        }
    });

    // =====================================================
    // 🟢 /balance
    // =====================================================
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

            const balance = res.data.balance || "0.00";
            const currency = res.data.currency || "USD";

            bot.sendMessage(chatId, `💰 *Your JAP Balance:*\n${balance} ${currency}`, {
                parse_mode: "Markdown",
            });
        } catch (err) {
            console.error("Balance check error:", err.message);
            bot.sendMessage(chatId, "❗️ Failed to fetch JAP balance.");
        }
    });

    // =====================================================
    // 🟢 /order (Interactive flow)
    // =====================================================
    bot.onText(/\/order/, async (msg) => {
        const chatId = msg.chat.id;
        userStates[chatId] = { step: "awaiting_link" };
        bot.sendMessage(chatId, "🔗 Please send the link for your order:");
    });

    // Step-by-step handling
    bot.on("message", async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text;

        if (text.startsWith("/")) return;
        const state = userStates[chatId];
        if (!state) return;

        try {
            if (state.step === "awaiting_link") {
                state.link = text;
                state.step = "awaiting_quantity";
                bot.sendMessage(chatId, "📦 Got it! Now enter the *quantity*:", { parse_mode: "Markdown" });
            } else if (state.step === "awaiting_quantity") {
                const quantity = parseInt(text);
                if (isNaN(quantity) || quantity <= 0) {
                    return bot.sendMessage(chatId, "❗ Please enter a valid number for quantity.");
                }
                state.quantity = quantity;
                state.step = "awaiting_confirmation";

                bot.sendMessage(
                    chatId,
                    `Confirm your order:\n\n🔗 Link: ${state.link}\n📦 Quantity: ${state.quantity}`,
                    {
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

    // =====================================================
    // Handle inline button callbacks
    // =====================================================
    bot.on("callback_query", async (callbackQuery) => {
        const chatId = callbackQuery.message.chat.id;
        const data = callbackQuery.data;
        const state = userStates[chatId];

        if (!state) return bot.answerCallbackQuery(callbackQuery.id);

        if (data === "cancel_order") {
            delete userStates[chatId];
            bot.sendMessage(chatId, "❌ Order cancelled.");
            return bot.answerCallbackQuery(callbackQuery.id);
        }

        if (data === "confirm_order") {
            if (!state.link || !state.quantity) {
                bot.sendMessage(chatId, "⚠️ Missing order details. Please start again with /order.");
                return bot.answerCallbackQuery(callbackQuery.id);
            }

            bot.sendMessage(chatId, "⏳ Placing your order, please wait...");

            try {
                // ✅ Use BOT_JWT for authorization
                const response = await axios.post(
                    `${url}/api/jap/order`,
                    {
                        serviceId: process.env.DEFAULT_SERVICE_ID || 1,
                        link: state.link,
                        quantity: state.quantity,
                        chatId: chatId,
                    },
                    {
                        headers: {
                            "Content-Type": "application/json",
                            Authorization: `Bearer ${botJwt}`,
                        },
                    }
                );

                const { localOrder } = response.data;
                bot.sendMessage(
                    chatId,
                    `✅ *Order Placed Successfully!*\n\n🆔 Order ID: ${localOrder.id}\n📦 Status: ${localOrder.status}`,
                    { parse_mode: "Markdown" }
                );
            } catch (err) {
                console.error("Order placement error:", err.response?.data || err.message);
                bot.sendMessage(chatId, "❗ Failed to place the order. Please try again later.");
            }

            delete userStates[chatId];
            bot.answerCallbackQuery(callbackQuery.id);
        }
    });
}

// =====================================================
// 🔔 Notify order status updates (from backend)
// =====================================================
export async function notifyOrderStatus(order) {
    if (!bot || !order.chatId) return;
    const msg = `📢 *Order Update*\n\n🆔 Order #${order.id}\n📦 Status: *${order.status.toUpperCase()}*`;
    try {
        await bot.sendMessage(order.chatId, msg, { parse_mode: "Markdown" });
    } catch (err) {
        console.error("Telegram notify error:", err.message);
    }
}
