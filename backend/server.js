// server.js
import express from "express";
import cors from "cors";
import multer from "multer";
import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { generateFromAudio, generateFromText } from "./gemini.js";
import say from "say";

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(express.json());

// Ensure uploads directory exists
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);

const upload = multer({ dest: uploadsDir });

// ===== SSE clients =====
let clients = [];
app.get("/stream", (req, res) => {
  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });
  res.flushHeaders?.();

  // Send initial connection ping
  res.write(`event: ping\ndata: "connected"\n\n`);

  clients.push(res);
  req.on("close", () => {
    clients = clients.filter((c) => c !== res);
  });
});

// Broadcast helper
function broadcast(obj) {
  const line = `data: ${JSON.stringify(obj)}\n\n`;
  clients.forEach((c) => {
    try {
      c.write(line);
    } catch {}
  });
}

// Interrupt any playback
function interruptPlayback() {
  broadcast({ type: "stop" });
}

// ===== Audio upload endpoint =====
app.post("/voice", upload.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "No file uploaded" });

  interruptPlayback();
  const guessedMime = req.body?.mimeType || req.file.mimetype || "audio/webm";

  broadcast({ type: "status", message: "Processing audio..." });

  try {
    const audioBase64 = fs.readFileSync(req.file.path).toString("base64");
    const text = await generateFromAudio({ audioBase64, mimeType: guessedMime });

    // Remove uploaded file
    fs.unlink(req.file.path, () => {});

    broadcast({ type: "assistant", text: text || "(No response recognized)" });

    // Generate TTS audio
    const audioFile = path.join(uploadsDir, `response-${Date.now()}.wav`);
    say.export(text || "I didn't catch that.", null, 1.0, audioFile, (err) => {
      if (err) return console.error("TTS export failed:", err);

      try {
        const audioBuffer = fs.readFileSync(audioFile);
        broadcast({ type: "response_audio", audio: audioBuffer.toString("base64") });
      } catch (e) {
        console.error("Failed to read TTS audio:", e);
      } finally {
        fs.unlink(audioFile, () => {});
      }
    });

    res.json({ ok: true, text });
  } catch (err) {
    console.error("Error processing audio:", err);
    res.status(500).json({ error: "Failed to process audio" });
  }
});

// ===== Text chat endpoint =====
app.post("/chat", async (req, res) => {
  const { message } = req.body || {};
  if (!message) return res.status(400).json({ error: "Message required" });

  interruptPlayback();
  broadcast({ type: "status", message: "Processing message..." });

  try {
    const text = await generateFromText(message);
    broadcast({ type: "assistant", text });

    // Generate TTS
    const audioFile = path.join(uploadsDir, `response-${Date.now()}.wav`);
    say.export(text || "", null, 1.0, audioFile, (err) => {
      if (err) return console.error("TTS export failed:", err);

      try {
        const audioBuffer = fs.readFileSync(audioFile);
        broadcast({ type: "response_audio", audio: audioBuffer.toString("base64") });
      } catch (e) {
        console.error("Failed to read TTS audio:", e);
      } finally {
        fs.unlink(audioFile, () => {});
      }
    });

    res.json({ ok: true, text });
  } catch (err) {
    console.error("Error processing chat:", err);
    res.status(500).json({ error: "Failed to process message" });
  }
});

// ===== Start server =====
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
