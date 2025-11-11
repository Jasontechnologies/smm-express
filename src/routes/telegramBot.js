import TelegramBot from "node-telegram-bot-api";
import axios from "axios";
import dotenv from "dotenv";
import { store } from "../store.js";
import { fetchServices } from "../japClient.js";

dotenv.config();

export function setupTelegramBot(app) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const url = process.env.HOST_URL;

    if (!token || !url) {
        console.warn("⚠️ Missing TELEGRAM_BOT_TOKEN or HOST_URL — skipping Telegram setup.");
        return;
    }

    // ✅ Initialize Telegram bot (webhook mode)
    const bot = new TelegramBot(token);
    bot.setWebHook(`${url}/bot${token}`);
    console.log(`🌐 Webhook set at ${url}/bot${token}`);

    // ✅ Webhook route attached to main Express app
    app.post(`/bot${token}`, (req, res) => {
        console.log("📩 Telegram update received");
        bot.processUpdate(req.body);
        res.sendStatus(200);
    });

    // In-memory state per user session
    const userStates = {};

    // =====================================================
    // 🟢 START COMMAND
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
    // 🟢 SET JAP API KEY
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
            bot.sendMessage(chatId, "❗ Failed to save JAP key.");
        }
    });

    // =====================================================
    // 🟢 CHECK BALANCE
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
            bot.sendMessage(chatId, "❗ Failed to fetch JAP balance. Please check your JAP key.");
        }
    });

    // =====================================================
    // 🟢 ORDER FLOW — Interactive Service Selection
    // =====================================================
    bot.onText(/\/order/, async (msg) => {
        const chatId = msg.chat.id;

        try {
            const settings = await store.getSettings();
            const key = settings.japKey || process.env.JAP_API_KEY;

            bot.sendMessage(chatId, "📦 Fetching available Twitter services...");
            const services = await fetchServices(key);

            if (!services.length) {
                return bot.sendMessage(chatId, "❗ No JAP services found. Please check your JAP key.");
            }

            // Inline buttons for available services
            const inlineKeyboard = services.slice(0, 10).map((s) => [
                { text: s.name.slice(0, 40), callback_data: `select_service_${s.service}` },
            ]);

            userStates[chatId] = { step: "selecting_service", services };

            bot.sendMessage(chatId, "👇 Select a service:", {
                reply_markup: { inline_keyboard: inlineKeyboard },
            });
        } catch (err) {
            console.error("Service fetch error:", err.message);
            bot.sendMessage(chatId, "❗ Failed to fetch JAP services.");
        }
    });

    // =====================================================
    // 🟢 CALLBACK HANDLERS (buttons)
    // =====================================================
    bot.on("callback_query", async (callbackQuery) => {
        const chatId = callbackQuery.message.chat.id;
        const data = callbackQuery.data;
        const state = userStates[chatId];

        if (!state) return bot.answerCallbackQuery(callbackQuery.id);

        try {
            // ✅ Service selected
            if (data.startsWith("select_service_")) {
                const serviceId = data.replace("select_service_", "");
                const service = state.services.find((s) => String(s.service) === serviceId);
                state.service = service;
                state.step = "awaiting_link";

                bot.sendMessage(
                    chatId,
                    `✅ Selected: *${service.name}*\n\n🔗 Send the link for your order:`,
                    { parse_mode: "Markdown" }
                );
            }

            // ❌ Cancel order
            if (data === "cancel_order") {
                delete userStates[chatId];
                bot.sendMessage(chatId, "❌ Order cancelled.");
            }

            // ✅ Confirm order
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
                        chatId: chatId,
                    });

                    const { localOrder } = response.data;
                    bot.sendMessage(
                        chatId,
                        `✅ *Order placed successfully!*\n\n🆔 Order ID: ${localOrder.id}\n📦 Status: ${localOrder.status}`,
                        { parse_mode: "Markdown" }
                    );
                } catch (err) {
                    console.error("Order placement error:", err.response?.data || err.message);
                    bot.sendMessage(chatId, "❗ Failed to place order. Please try again later.");
                }

                delete userStates[chatId];
            }

            bot.answerCallbackQuery(callbackQuery.id);
        } catch (err) {
            console.error("Callback error:", err.message);
            bot.answerCallbackQuery(callbackQuery.id);
        }
    });

    // =====================================================
    // 🟢 MESSAGE HANDLER (link → quantity → confirm)
    // =====================================================
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
                bot.sendMessage(chatId, "📊 Great! Now enter the *quantity*:", { parse_mode: "Markdown" });
            } else if (state.step === "awaiting_quantity") {
                const quantity = parseInt(text);
                if (isNaN(quantity) || quantity <= 0) {
                    return bot.sendMessage(chatId, "⚠️ Please enter a valid number.");
                }
                state.quantity = quantity;
                state.step = "confirming";

                bot.sendMessage(
                    chatId,
                    `🧾 *Confirm your order:*\n\n🛠 Service: ${state.service.name}\n🔗 Link: ${state.link}\n📦 Quantity: ${state.quantity}`,
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
            console.error("Message handling error:", err.message);
        }
    });

    // =====================================================
    // 🟢 Order status updates (called externally)
    // =====================================================
    export async function notifyOrderStatus(order) {
        if (!order.chatId) return;
        const msg = `📢 *Order Update*\n\n🆔 Order #${order.id}\n📦 Status: *${order.status.toUpperCase()}*`;
        try {
            await bot.sendMessage(order.chatId, msg, { parse_mode: "Markdown" });
        } catch (err) {
            console.error("Telegram notify error:", err.message);
        }
    }
}
