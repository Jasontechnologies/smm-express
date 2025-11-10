import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { store } from "../store.js";
import dotenv from "dotenv";
dotenv.config();

const router = express.Router();

router.post("/login", async (req, res) => {
  const { email, password } = req.body;
  const user = await store.getUserByEmail(email);
  if (!user) return res.status(401).json({ error: "Invalid credentials" });
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(401).json({ error: "Invalid credentials" });

  const token = jwt.sign({ userId: user.id, email: user.email }, process.env.JWT_SECRET || "secret", { expiresIn: "7d" });
  res.json({ token, user: { email: user.email } });
});

export default router;
