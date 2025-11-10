import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

const JAP_URL = "https://justanotherpanel.com/api/v2";
const DEFAULT_TIMEOUT = 10000;

async function japPost(paramsObj) {
    const params = new URLSearchParams();
    for (const k in paramsObj) params.append(k, paramsObj[k]);
    try {
        const res = await axios.post(JAP_URL, params.toString(), {
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            timeout: DEFAULT_TIMEOUT
        });
        return res.data;
    } catch (err) {
        const message = err.response?.data || err.message || "JAP request failed";
        throw new Error(typeof message === "string" ? message : JSON.stringify(message));
    }
}

export async function fetchServices(japKey) {
    const key = japKey || process.env.JAP_API_KEY;
    const data = await japPost({ key, action: "services" });
    if (!Array.isArray(data)) return [];
    const keywords = ["view", "impression", "bookmark"];
    const filtered = data.filter(s => {
        const cat = (s.category || "").toLowerCase();
        const name = (s.name || "").toLowerCase();
        if (!cat.includes("twitter") && !name.includes("twitter")) return false;
        return keywords.some(k => name.includes(k));
    });
    return filtered;
}

export async function addOrder(japKey, { service, link, quantity, runs, interval }) {
    const key = japKey || process.env.JAP_API_KEY;
    const body = { key, action: "add", service: String(service), link: String(link) };
    if (quantity) body.quantity = String(quantity);
    if (runs) body.runs = String(runs);
    if (interval) body.interval = String(interval);
    return japPost(body);
}

// Fixed status mapping - removed duplicates and added proper mapping
export function mapJapStatus(japStatus) {
    const statusMap = {
        // JAP API Status -> Your Internal Status
        'processing': 'placing',
        'in progress': 'in progress',
        'completed': 'completed',
        'partial': 'partial',
        'canceled': 'cancelled',
        'cancelled': 'cancelled',
        'refund': 'refunded',
        'refunds': 'refunded',
        'pending': 'pending',
        'placed': 'in progress',
        'error': 'error'
    };

    const normalizedStatus = japStatus?.toLowerCase().trim();
    return statusMap[normalizedStatus] || 'pending';
}

// Update getOrderStatus to return mapped status
export async function getOrderStatus(japKey, orderId) {
    const key = japKey || process.env.JAP_API_KEY;
    const res = await japPost({ key, action: "status", order: String(orderId) });

    // Add status mapping
    if (res.status) {
        res.mappedStatus = mapJapStatus(res.status);
    }

    return res;
}

export async function getBalance(japKey) {
    const key = japKey || process.env.JAP_API_KEY;
    const res = await japPost({ key, action: "balance" });
    return res;
}