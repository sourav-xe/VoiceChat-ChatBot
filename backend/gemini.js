import axios from "axios";
import dotenv from "dotenv";
dotenv.config();

export const MODEL = process.env.GEMINI_MODEL || "gemini-2.0-flash-live-001";
export const BASE = process.env.GEMINI_BASE || "https://generativelanguage.googleapis.com/v1beta";
const API_KEY = process.env.GOOGLE_API_KEY;

if (!API_KEY) console.warn("WARNING: GOOGLE_API_KEY not set in .env");

async function withRetry(fn, retries = 3, delay = 800) {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); }
    catch (err) {
      const status = err?.response?.status;
      if ((status === 429 || (status >= 500 && status < 600)) && i < retries - 1) {
        await new Promise(r => setTimeout(r, delay * Math.pow(2, i)));
        continue;
      }
      throw err;
    }
  }
}

function systemPrompt() {
  return `
You are "Rev", the Revolt Motors assistant.
Answer all questions factually and clearly.
Do NOT repeat the user's words.
Always respond in the language of the user's question.
  `.trim();
}

// Generate text from Gemini
export async function generateFromText(message) {
  if (!API_KEY) throw new Error("Missing GOOGLE_API_KEY in .env");

  const url = `${BASE}/models/${MODEL}:generateContent?key=${API_KEY}`;
  const body = {
    contents: [
      { role: "user", parts: [{ text: systemPrompt() }, { text: message }] }
    ],
  };

  const { data } = await withRetry(() =>
    axios.post(url, body, { headers: { "Content-Type": "application/json" }, timeout: 60000 })
  );

  const text = data?.candidates?.[0]?.content?.parts
    ?.map(p => p.text || "")
    .join("")
    .trim();

  // Only fallback if Gemini completely fails
  return text || "Sorry, I could not process your question. Please try again.";
}

// Generate from audio
export async function generateFromAudio({ audioBase64, mimeType = "audio/webm" }) {
  if (!API_KEY) throw new Error("Missing GOOGLE_API_KEY in .env");

  const url = `${BASE}/models/${MODEL}:generateContent?key=${API_KEY}`;
  const body = {
    contents: [
      { role: "user", parts: [{ text: systemPrompt() }, { inlineData: { mimeType, data: audioBase64 } }] }
    ],
  };

  const { data } = await withRetry(() =>
    axios.post(url, body, { headers: { "Content-Type": "application/json" }, timeout: 60000 })
  );

  const text = data?.candidates?.[0]?.content?.parts
    ?.map(p => p.text || "")
    .join("")
    .trim();

  return text || "Sorry, I could not understand the audio. Please try again.";
}
