import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { generateFromAudio, generateFromText } from "./gemini.js";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Ensure uploads dir exists
const uploadsDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const upload = multer({ dest: "uploads/" });

// ==== Simple in-memory list of SSE clients ====
let clients = [];
app.get("/stream", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });
  res.flushHeaders?.();

  // A hello ping so browsers keep connection open
  res.write(`event: ping\ndata: "connected"\n\n`);

  clients.push(res);
  req.on("close", () => {
    clients = clients.filter((c) => c !== res);
  });
});
function broadcast(obj) {
  const line = `data: ${JSON.stringify(obj)}\n\n`;
  clients.forEach((c) => c.write(line));
}

// ==== Audio upload -> Gemini -> broadcast reply ====
app.post("/voice", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    // Guess a mime type from extension if present (fallback to webm)
    const ext = path.extname(req.file.originalname || "").toLowerCase();
    const mimeGuess =
      ext === ".wav"
        ? "audio/wav"
        : ext === ".mp3"
        ? "audio/mpeg"
        : ext === ".ogg"
        ? "audio/ogg"
        : "audio/webm";

    const audioBase64 = fs.readFileSync(req.file.path).toString("base64");

    // Optional: tell the UI we started processing
    broadcast({ type: "status", message: "Processing audio..." });

    const text = await generateFromAudio({
      audioBase64,
      mimeType: mimeGuess
    });

    // Clean temp file
    fs.unlink(req.file.path, () => {});

    // Broadcast the model reply to all connected clients
    broadcast({ type: "assistant", text });

    // Also send an immediate HTTP response back to the uploader
    res.json({ ok: true, text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to process audio" });
  }
});

// ==== Optional: plain text chat endpoint ====
app.post("/chat", async (req, res) => {
  try {
    const { message } = req.body || {};
    if (!message) return res.status(400).json({ error: "message required" });
    const text = await generateFromText(message);
    broadcast({ type: "assistant", text });
    res.json({ ok: true, text });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to process message" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
