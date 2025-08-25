// backend/server.js
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { generateFromAudio, generateFromText } from "./gemini.js";
import gTTS from "gtts";

dotenv.config();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const upload = multer({ dest: uploadsDir });

// -------------------- SSE Clients --------------------
let clients = [];
app.get("/stream", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders?.();
  res.write(`data: ${JSON.stringify({ type: "connected" })}\n\n`);
  clients.push(res);
  req.on("close", () => (clients = clients.filter((c) => c !== res)));
});

function broadcast(obj) {
  const line = `data: ${JSON.stringify(obj)}\n\n`;
  clients.forEach((c) => {
    try { c.write(line); } catch {}
  });
}

// -------------------- Job & Cancellation --------------------
let currentJob = null;
function startJob(meta = {}) {
  if (currentJob && !currentJob.cancelled) {
    currentJob.cancelled = true;
    broadcast({ type: "stop" });
  }
  currentJob = { id: Date.now(), cancelled: false, ...meta };
  return currentJob;
}
app.post("/interrupt", (req, res) => {
  if (currentJob && !currentJob.cancelled) {
    currentJob.cancelled = true;
    broadcast({ type: "stop" });
    return res.json({ ok: true, message: "Interrupted" });
  }
  res.json({ ok: true, message: "Nothing to interrupt" });
});

// -------------------- Rate Limiting --------------------
const RATE_LIMIT_TOKENS = parseFloat(process.env.RATE_LIMIT_TOKENS || "6");
const RATE_LIMIT_REFILL_SEC = parseFloat(process.env.RATE_LIMIT_REFILL_SEC || "10");
let tokens = RATE_LIMIT_TOKENS;
let lastRefill = Date.now();

function refillTokens() {
  const now = Date.now();
  const elapsed = (now - lastRefill) / 1000;
  if (elapsed <= 0) return;
  const refillAmount = (elapsed / RATE_LIMIT_REFILL_SEC) * RATE_LIMIT_TOKENS;
  if (refillAmount > 0) {
    tokens = Math.min(RATE_LIMIT_TOKENS, tokens + refillAmount);
    lastRefill = now;
  }
}

function tryConsumeToken() {
  refillTokens();
  if (tokens >= 1) {
    tokens -= 1;
    return true;
  }
  return false;
}

async function waitForToken(maxWaitMs = 2000) {
  const start = Date.now();
  while (!tryConsumeToken()) {
    if (Date.now() - start > maxWaitMs) return false;
    await new Promise((r) => setTimeout(r, 150));
  }
  return true;
}

// -------------------- Helper: gTTS & Broadcast --------------------
async function speakAndBroadcast(text, job) {
  if (!text || job.cancelled) return;

  const isHindi = /[\u0900-\u097F]/.test(text); // Detect Devanagari
  const audioFile = path.join(uploadsDir, `response-${Date.now()}.mp3`);
  
  return new Promise((resolve) => {
    const tts = new gTTS(text, isHindi ? "hi" : "en");
    tts.save(audioFile, async (err) => {
      if (err) {
        console.error("TTS save failed:", err);
        resolve();
        return;
      }
      try {
        if (!job.cancelled) {
          const buffer = fs.readFileSync(audioFile);
          broadcast({ type: "response_audio", audio: buffer.toString("base64") });
        }
      } catch (e) {
        console.error("Failed to read audio file:", e);
      } finally {
        fs.unlink(audioFile, () => {});
        resolve();
      }
    });
  });
}

// -------------------- /voice Endpoint --------------------
app.post("/voice", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  const allow = await waitForToken(2000);
  if (!allow) {
    fs.unlink(req.file.path, () => {});
    broadcast({ type: "status", message: "Rate limited: try again later." });
    return res.status(429).json({ error: "Rate limited" });
  }

  const job = startJob({ type: "voice" });
  broadcast({ type: "status", message: "Processing audio..." });

  try {
    const audioBase64 = fs.readFileSync(req.file.path).toString("base64");
    fs.unlink(req.file.path, () => {});

    const assistantText = await generateFromAudio({ audioBase64, mimeType: req.body.mimeType || "audio/webm" });

    if (!assistantText || job.cancelled) return res.json({ ok: true, cancelled: true });

    broadcast({ type: "assistant", text: assistantText });
    await speakAndBroadcast(assistantText, job);

    res.json({ ok: true, text: assistantText });
  } catch (err) {
    console.error("Error processing audio:", err);
    if (!res.headersSent) res.status(500).json({ error: "Failed to process audio" });
    broadcast({ type: "status", message: "Server error processing audio." });
  }
});

// -------------------- /chat Endpoint --------------------
app.post("/chat", async (req, res) => {
  const { message } = req.body || {};
  if (!message) return res.status(400).json({ error: "Message required" });

  const allow = await waitForToken(1000);
  if (!allow) return res.status(429).json({ error: "Rate limited" });

  const job = startJob({ type: "chat" });
  broadcast({ type: "status", message: "Processing message..." });

  try {
    const assistantText = await generateFromText(message);

    if (!assistantText || job.cancelled) return res.json({ ok: true, cancelled: true });

    broadcast({ type: "assistant", text: assistantText });
    await speakAndBroadcast(assistantText, job);

    res.json({ ok: true, text: assistantText });
  } catch (err) {
    console.error("Error processing chat:", err);
    res.status(500).json({ error: "Failed to process message" });
    broadcast({ type: "status", message: "Server error processing message." });
  }
});

// -------------------- Start Server --------------------
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
