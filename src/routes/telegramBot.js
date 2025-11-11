import TelegramBot from "node-telegram-bot-api";
import axios from "axios";
import dotenv from "dotenv";
import { store } from "../store.js";
import { fetchServices, getOrderStatus } from "../japClient.js";

dotenv.config();

let bot;

export function setupTelegramBot(app) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const url = process.env.HOST_URL;
    const botJwt = process.env.BOT_JWT;

    if (!token || !url) {
        console.warn("⚠️ Missing TELEGRAM_BOT_TOKEN or HOST_URL — skipping Telegram setup.");
        return;
    }

    bot = new TelegramBot(token);
    bot.setWebHook(`${url}/bot${token}`);
    console.log(`🌐 Telegram webhook set at: ${url}/bot${token}`);

    app.post(`/bot${token}`, (req, res) => {
        console.log("📩 Telegram update received");
        bot.processUpdate(req.body);
        res.sendStatus(200);
    });

    const userStates = {};
    const servicesCache = {};

    // =====================================================
    // 👋 GREETING HANDLER (for "hi", "hello", etc.)
    // =====================================================
    bot.on("message", (msg) => {
        const text = msg.text?.toLowerCase();
        if (!text || text.startsWith("/")) return;

        const greetings = ["hi", "hello", "hey", "yo", "hola"];
        if (greetings.some((g) => text.includes(g))) {
            return bot.sendMessage(
                msg.chat.id,
                "👋 *Hey there!* Welcome to *Quantum JAP Bot* 🚀\n\n" +
                "I can help you place orders, check balances, or set your JAP API key.\n\n" +
                "Choose one below 👇",
                {
                    parse_mode: "Markdown",
                    reply_markup: {
                        inline_keyboard: [
                            [{ text: "🛍️ Place Order", callback_data: "start_order" }],
                            [{ text: "💰 Check Balance", callback_data: "check_balance" }],
                            [{ text: "📦 Check Order Status", callback_data: "check_status" }],
                            [{ text: "⚙️ Set JAP Key", callback_data: "set_key_help" }],
                        ],
                    },
                }
            );
        }
    });

    // =====================================================
    // 🟢 /start Command
    // =====================================================
    bot.onText(/\/start/, (msg) => {
        bot.sendMessage(
            msg.chat.id,
            "✨ *Welcome to Quantum JAP Bot!* ✨\n\n" +
            "Here’s what I can do:\n\n" +
            "🛍️ Place new JAP orders\n💰 Check your JAP balance\n📦 Track your order status\n⚙️ Save your JAP API key\n\n" +
            "What would you like to do?",
            {
                parse_mode: "Markdown",
                reply_markup: {
                    inline_keyboard: [
                        [{ text: "🛍️ Place Order", callback_data: "start_order" }],
                        [{ text: "💰 Check Balance", callback_data: "check_balance" }],
                        [{ text: "📦 Check Order Status", callback_data: "check_status" }],
                        [{ text: "⚙️ Set JAP Key", callback_data: "set_key_help" }],
                    ],
                },
            }
        );
    });

    // =====================================================
    // ⚙️ Inline Buttons Handler
    // =====================================================
    bot.on("callback_query", async (callbackQuery) => {
        const chatId = callbackQuery.message.chat.id;
        const data = callbackQuery.data;
        const state = userStates[chatId] || {};

        try {
            // ===========================
            // 🛍️ Start Order
            // ===========================
            if (data === "start_order") {
                bot.sendMessage(chatId, "🔍 Fetching Twitter services... Please wait!");
                const settings = await store.getSettings();
                const key = settings.japKey || process.env.JAP_API_KEY;
                const services = await fetchServices(key);

                if (!services.length)
                    return bot.sendMessage(chatId, "⚠️ No Twitter services found. Check your JAP key.");

                servicesCache[chatId] = { services, page: 0 };
                showServicePage(chatId, 0);
            }

            // ===========================
            // 💰 Check Balance
            // ===========================
            if (data === "check_balance") {
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
            }

            // ===========================
            // ⚙️ Help with /setkey
            // ===========================
            if (data === "set_key_help") {
                bot.sendMessage(
                    chatId,
                    "🧩 To set your JAP API key, type:\n\n`/setkey your_api_key_here`",
                    { parse_mode: "Markdown" }
                );
            }

            // ===========================
            // 📦 Check Order Status
            // ===========================
            if (data === "check_status") {
                bot.sendMessage(
                    chatId,
                    "📦 How would you like to check order status?",
                    {
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: "📜 View Last 5 Orders", callback_data: "last_orders" }],
                                [{ text: "🔍 Check Specific Order ID", callback_data: "specific_status" }],
                            ],
                        },
                    }
                );
            }

            // ===========================
            // 🟢 Show Last 5 Orders (Detailed)
            // ===========================
            if (data === "last_orders") {
                const lastOrders = await store.getOrders();
                if (!lastOrders.length) {
                    bot.sendMessage(chatId, "😕 No recent orders found.");
                    return;
                }

                const recent = lastOrders.slice(0, 5);
                for (const order of recent) {
                    const id = order.japOrderId || order._id.toString().slice(-6);
                    const service = order.serviceName || order.serviceId || "Unknown Service";
                    const status = order.status || "Pending";
                    const quantity = order.quantity || "N/A";
                    const link = order.link?.slice(0, 60) + (order.link?.length > 60 ? "..." : "");
                    const date = new Date(order.createdAt).toLocaleString("en-GB", {
                        dateStyle: "medium",
                        timeStyle: "short",
                    });

                    const msg =
                        `🧾 *Order #${id}*
━━━━━━━━━━━━━━━
📦 *Service:* ${service}
🔗 *Link:* ${link}
📊 *Quantity:* ${quantity}
📅 *Created:* ${date}
📈 *Status:* ${status.toUpperCase()}`;

                    await bot.sendMessage(chatId, msg, {
                        parse_mode: "Markdown",
                        reply_markup: {
                            inline_keyboard: [
                                [{ text: "🔍 View JAP Status", callback_data: `order_${order.japOrderId || order._id}` }],
                            ],
                        },
                    });
                }

                await bot.sendMessage(
                    chatId,
                    "🌍 *View all your orders:*\nhttps://smm-react-six.vercel.app/orders",
                    { parse_mode: "Markdown" }
                );
                return;
            }

            // ===========================
            // 🔍 Specific Order Entry
            // ===========================
            if (data === "specific_status") {
                userStates[chatId] = { step: "awaiting_status_id" };
                bot.sendMessage(chatId, "🔍 Please enter your JAP Order ID:");
                return;
            }

            // ===========================
            // 🔍 View JAP Status for Specific Order
            // ===========================
            if (data.startsWith("order_")) {
                const orderId = data.replace("order_", "").trim();
                const settings = await store.getSettings();
                const key = settings.japKey || process.env.JAP_API_KEY;

                try {
                    const statusData = await getOrderStatus(key, orderId);
                    const status = statusData.mappedStatus || statusData.status || "Unknown";
                    const charge = statusData.charge || "N/A";
                    const startCount = statusData.start_count || "N/A";
                    const remains = statusData.remains || "N/A";

                    bot.sendMessage(
                        chatId,
                        `📦 *Order Status*\n\n🆔 Order ID: ${orderId}\n📊 Status: *${status.toUpperCase()}*\n💵 Charge: ${charge}\n📈 Start: ${startCount}\n📉 Remains: ${remains}\n\n🔗 *View all your orders:*\nhttps://smm-react-six.vercel.app/orders`,
                        { parse_mode: "Markdown" }
                    );
                } catch (err) {
                    console.error("Order check error:", err.message);
                    bot.sendMessage(
                        chatId,
                        `❗ Could not find details for Order ID: ${orderId}\n\nPlease verify on the dashboard:\nhttps://smm-react-six.vercel.app/orders`
                    );
                }
                return;
            }

            // ===========================
            // Order Confirmation & Cancel
            // ===========================
            if (data === "cancel_order") {
                delete userStates[chatId];
                bot.sendMessage(chatId, "❌ Order cancelled.");
            }

            if (data === "confirm_order") {
                if (!state.link || !state.quantity || !state.serviceId) {
                    bot.sendMessage(chatId, "⚠️ Missing order details. Please start again.");
                    return;
                }

                bot.sendMessage(chatId, "⏳ Placing your order...");

                try {
                    const response = await axios.post(
                        `${url}/api/jap/order`,
                        {
                            serviceId: state.serviceId,
                            link: state.link,
                            quantity: state.quantity,
                            chatId,
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
                    console.error("Order error:", err.response?.data || err.message);
                    bot.sendMessage(chatId, "❗ Failed to place order. Please try again later.");
                }

                delete userStates[chatId];
            }

            bot.answerCallbackQuery(callbackQuery.id);
        } catch (err) {
            console.error("Callback error:", err.message);
        }
    });

    // =====================================================
    // 🧾 Handle Manual Status Entry & Order Messages
    // =====================================================
    bot.on("message", async (msg) => {
        const chatId = msg.chat.id;
        const text = msg.text;
        if (!text || text.startsWith("/")) return;

        const state = userStates[chatId];
        if (!state) return;

        // 🔍 Manual JAP order ID check
        if (state.step === "awaiting_status_id") {
            const orderId = text.trim();
            if (!/^\d+$/.test(orderId)) {
                return bot.sendMessage(chatId, "❗ Please enter a valid numeric Order ID.");
            }

            bot.sendMessage(chatId, "⏳ Checking order status...");
            delete userStates[chatId];

            try {
                const settings = await store.getSettings();
                const key = settings.japKey || process.env.JAP_API_KEY;

                const statusData = await getOrderStatus(key, orderId);
                const status = statusData.mappedStatus || statusData.status || "Unknown";
                const charge = statusData.charge || "N/A";
                const startCount = statusData.start_count || "N/A";
                const remains = statusData.remains || "N/A";

                bot.sendMessage(
                    chatId,
                    `📦 *Order Status*\n\n🆔 Order ID: ${orderId}\n📊 Status: *${status.toUpperCase()}*\n💵 Charge: ${charge}\n📈 Start: ${startCount}\n📉 Remains: ${remains}\n\n🔗 *View all your orders:*\nhttps://smm-react-six.vercel.app/orders`,
                    { parse_mode: "Markdown" }
                );
            } catch (err) {
                console.error("Specific status error:", err.message);
                bot.sendMessage(
                    chatId,
                    `❌ Order not found for ID: ${orderId}\n\nCheck here:\nhttps://smm-react-six.vercel.app/orders`
                );
            }
        }

        // 🔗 Order Flow: Link & Quantity
        if (state.step === "awaiting_link") {
            state.link = text;
            state.step = "awaiting_quantity";
            bot.sendMessage(chatId, "📦 Got it! Now enter the *quantity*:", { parse_mode: "Markdown" });
        } else if (state.step === "awaiting_quantity") {
            const quantity = parseInt(text);
            if (isNaN(quantity) || quantity <= 0)
                return bot.sendMessage(chatId, "❗ Please enter a valid number for quantity.");
            state.quantity = quantity;
            state.step = "awaiting_confirmation";

            bot.sendMessage(
                chatId,
                `🧾 Confirm your order:\n\n🔹 Service ID: ${state.serviceId}\n🔗 Link: ${state.link}\n📦 Quantity: ${state.quantity}`,
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
    });

    // =====================================================
    // 📋 Pagination for Services
    // =====================================================
    function showServicePage(chatId, page = 0) {
        const cache = servicesCache[chatId];
        if (!cache) return;

        const pageSize = 5;
        const start = page * pageSize;
        const slice = cache.services.slice(start, start + pageSize);

        const buttons = slice.map((s) => [
            { text: `${s.service} - ${s.name.slice(0, 35)}...`, callback_data: `service_${s.service}` },
        ]);

        const nav = [];
        if (page > 0) nav.push({ text: "◀️ Prev", callback_data: "page_prev" });
        if (start + pageSize < cache.services.length) nav.push({ text: "Next ▶️", callback_data: "page_next" });
        if (nav.length) buttons.push(nav);

        bot.sendMessage(chatId, `📋 *Available Services* (Page ${page + 1})`, {
            parse_mode: "Markdown",
            reply_markup: { inline_keyboard: buttons },
        });
    }
}

// =====================================================
// 🔔 Notify Order Status Updates
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
