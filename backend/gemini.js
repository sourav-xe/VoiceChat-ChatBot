import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const API_KEY = process.env.GOOGLE_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";
const BASE = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Send a single audio clip (base64) to Gemini and return the model text.
 * mimeType should match what you recorded/uploaded (webm/ogg/wav/mpeg etc).
 */
export async function generateFromAudio({ audioBase64, mimeType = "audio/webm" }) {
  if (!API_KEY) throw new Error("Missing GOOGLE_API_KEY in environment");
  const url = `${BASE}/models/${MODEL}:generateContent?key=${API_KEY}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          {
           text:
  "You are Rev, the Revolt Motors assistant. " +
  "Only answer questions about Revolt Motors (products, services, pricing, availability, test rides, dealerships, charging, warranty, app, and policies). " +
  "Do NOT repeat the user's exact words. Instead, directly provide a helpful response based on the user's question. " +
  "Respond concisely in the same language (English/Hindi).",

          },
          {
            inlineData: {
              mimeType,
              data: audioBase64,
            },
          },
        ],
      },
    ],
  };

  const { data } = await axios.post(url, body, {
    headers: { "Content-Type": "application/json" },
    timeout: 60_000,
  });

  const text =
    data?.candidates?.[0]?.content?.parts
      ?.map((p) => p.text || "")
      .join("")
      .trim() || "";

  return text;
}

/**
 * Text-only message (optional helper)
 */
export async function generateFromText(message) {
  if (!API_KEY) throw new Error("Missing GOOGLE_API_KEY in environment");
  const url = `${BASE}/models/${MODEL}:generateContent?key=${API_KEY}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: message }]}],
  };
  const { data } = await axios.post(url, body, {
    headers: { "Content-Type": "application/json" },
    timeout: 60_000,
  });
  const text =
    data?.candidates?.[0]?.content?.parts
      ?.map((p) => p.text || "")
      .join("")
      .trim() || "";
  return text;
}
