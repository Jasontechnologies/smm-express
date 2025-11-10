import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import dotenv from "dotenv";
dotenv.config();

// --------------------------------------------
// 🔹 1. Connect to MongoDB
// --------------------------------------------
export async function initStore() {
    const uri = process.env.MONGODB_URI;
    if (!uri) throw new Error("Missing MONGODB_URI in environment variables");

    try {
        await mongoose.connect(uri, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });
        console.log("✅ Connected to MongoDB Atlas");

        // Ensure admin user exists
        const count = await User.countDocuments();
        if (count === 0) {
            const email = process.env.ADMIN_EMAIL || "admin@example.com";
            const pwd = process.env.ADMIN_PASSWORD || "changeme123";
            const hashed = await bcrypt.hash(pwd, 10);
            const user = new User({
                email,
                password: hashed,
                createdAt: new Date(),
            });
            await user.save();
            console.log("Seeded default user:");
            console.log("  email:", email);
            console.log("  password:", pwd);
        }
    } catch (err) {
        console.error("❌ MongoDB connection error:", err.message);
        process.exit(1);
    }
}

// --------------------------------------------
// 🔹 2. Define Schemas
// --------------------------------------------

// User Schema
const userSchema = new mongoose.Schema({
    email: { type: String, unique: true },
    password: String,
    createdAt: { type: Date, default: Date.now },
});

// Order Schema
const orderSchema = new mongoose.Schema({
    serviceId: String,
    link: String,
    quantity: Number,
    runs: Number,
    interval: Number,
    japOrderId: String,
    status: { type: String, default: "pending" },
    error: String,
    chatId: String,
    createdAt: { type: Date, default: Date.now },
});

// Settings Schema
const settingsSchema = new mongoose.Schema({
    japKey: String,
    otherSettings: mongoose.Schema.Types.Mixed,
});

// --------------------------------------------
// 🔹 3. Create Models
// --------------------------------------------
const User = mongoose.model("User", userSchema);
const Order = mongoose.model("Order", orderSchema);
const Setting = mongoose.model("Setting", settingsSchema);

// --------------------------------------------
// 🔹 4. Store Interface (compatible with your code)
// --------------------------------------------
export const store = {
    // USERS ----------------------------
    async getUserByEmail(email) {
        return await User.findOne({ email });
    },

    async getUserById(id) {
        return await User.findById(id);
    },

    // ORDERS ---------------------------
    async saveOrder(order) {
        const newOrder = new Order(order);
        await newOrder.save();
        return newOrder.toObject();
    },

    async getOrders() {
        return await Order.find().sort({ createdAt: -1 });
    },

    // SETTINGS -------------------------
    async getSettings() {
        const s = await Setting.findOne();
        return s ? s.toObject() : {};
    },

    async setSettings(newSettings) {
        let settings = await Setting.findOne();
        if (!settings) settings = new Setting(newSettings);
        else Object.assign(settings, newSettings);
        await settings.save();
        return settings.toObject();
    },
};
