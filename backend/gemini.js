import axios from "axios";
import dotenv from "dotenv";

dotenv.config();

const API_KEY = process.env.GOOGLE_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-1.5-flash";
const BASE = "https://generativelanguage.googleapis.com/v1beta";

/**
 * Send a single audio clip (base64) to Gemini and return the model text.
 * mimeType should match what you record/upload (webm/ogg/wav/mpeg etc).
 */
export async function generateFromAudio({
  audioBase64,
  mimeType = "audio/webm"
}) {
  const url = `${BASE}/models/${MODEL}:generateContent?key=${API_KEY}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [
          { text: "You are a helpful voice assistant. Transcribe and reply." },
          {
            inlineData: {
              mimeType,
              data: audioBase64
            }
          }
        ]
      }
    ]
  };

  const { data } = await axios.post(url, body, {
    headers: { "Content-Type": "application/json" }
  });

  // Stitch text parts (Gemini can return multiple parts)
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
  const url = `${BASE}/models/${MODEL}:generateContent?key=${API_KEY}`;
  const body = {
    contents: [{ role: "user", parts: [{ text: message }]}]
  };
  const { data } = await axios.post(url, body, {
    headers: { "Content-Type": "application/json" }
  });
  const text =
    data?.candidates?.[0]?.content?.parts
      ?.map((p) => p.text || "")
      .join("")
      .trim() || "";
  return text;
}
