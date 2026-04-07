import puppeteer from "puppeteer";
import axios from "axios";
import express from "express";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const EVOLUCION_API_URL = process.env.EVOLUCION_API_URL;
const EVOLUCION_API_KEY = process.env.EVOLUCION_API_KEY;
const WHATSAPP_PHONE = process.env.WHATSAPP_PHONE;

const S3_BUCKET = process.env.BUCKET;
const S3_REGION = process.env.REGION;
const S3_ENDPOINT = process.env.ENDPOINT;
const S3_ACCESS_KEY_ID = process.env.ACCESS_KEY_ID;
const S3_SECRET_ACCESS_KEY = process.env.SECRET_ACCESS_KEY;

let browser;

async function initBrowser() {
  if (!browser) {
    browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });
  }
  return browser;
}

async function renderHtmlToPng(html) {
  const browser = await initBrowser();
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });
  await page.setViewport({ width: 1200, height: 800 });
  const pngBuffer = await page.screenshot({ type: "png" });
  await page.close();
  return pngBuffer;
}

async function uploadImageToS3(imageBuffer) {
  const filename = `image-${Date.now()}.png`;

  const s3Client = new S3Client({
    endpoint: S3_ENDPOINT,
    region: S3_REGION,
    credentials: {
      accessKeyId: S3_ACCESS_KEY_ID,
      secretAccessKey: S3_SECRET_ACCESS_KEY,
    },
  });

  await s3Client.send(
    new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: filename,
      Body: imageBuffer,
      ContentType: "image/png",
    })
  );

  return `${S3_ENDPOINT}/${S3_BUCKET}/${filename}`;
}

async function sendWhatsAppMessage(phoneNumber, imageBuffer) {
  // Normalize phone number to full international format (digits only, with country code).
  // Accepts: "3143607930", "+573143607930", "573143607930" → "573143607930"
  let normalizedPhone = String(phoneNumber).replace(/\D/g, "");
  if (!normalizedPhone.startsWith("57") || normalizedPhone.length <= 10) {
    // No country code present — prepend Colombia's country code
    normalizedPhone = "57" + normalizedPhone;
  }

  // TEMP DEBUG: Use a hardcoded public image URL to isolate whether the 403
  // is caused by the S3 URL being unreachable from Evolution API's network.
  // Replace with `await uploadImageToS3(imageBuffer)` once confirmed working.
  const imageUrl = "http://httpbin.org/image/png";
  console.log("[DEBUG] Using hardcoded test image URL (S3 upload skipped):", imageUrl);

  const requestPayload = {
    number: normalizedPhone,
    mediatype: "image",
    mimetype: "image/png",
    media: imageUrl,
    caption: "Imagen generada desde laboratorio",
    fileName: "image.png",
  };

  try {
    const requestUrl = `${EVOLUCION_API_URL}/message/sendMedia/what`;
    const requestHeaders = {
      apikey: EVOLUCION_API_KEY,
      "Content-Type": "application/json",
    };

    console.log("[DEBUG] Evolution API URL:", requestUrl);
    console.log(
      "[DEBUG] apikey header (first 10 chars of key):",
      EVOLUCION_API_KEY
        ? `${String(EVOLUCION_API_KEY).substring(0, 10)}...`
        : "(empty or undefined)"
    );
    console.log("[DEBUG] Headers being sent:", JSON.stringify({
      ...requestHeaders,
      apikey: EVOLUCION_API_KEY
        ? `${String(EVOLUCION_API_KEY).substring(0, 10)}...`
        : "(empty or undefined)",
    }, null, 2));
    console.log("[DEBUG] Request payload:", JSON.stringify(requestPayload, null, 2));

    const response = await axios.post(
      requestUrl,
      requestPayload,
      { headers: requestHeaders }
    );

    console.log("[DEBUG] Evolution API response status:", response.status);
    console.log("[DEBUG] Evolution API response data:", JSON.stringify(response.data, null, 2));

    return response.data;
  } catch (error) {
    console.error("Evolution API error status:", error.response?.status);
    console.error("Evolution API error data:", JSON.stringify(error.response?.data, null, 2));
    console.error("Evolution API request sent:", JSON.stringify(requestPayload, null, 2));
    console.error("[DEBUG] Evolution API request config headers:", JSON.stringify(error.config?.headers, null, 2));
    const detailedMessage = error.response?.data
      ? JSON.stringify(error.response.data)
      : error.message;
    throw new Error(`Evolution API failed (${error.response?.status}): ${detailedMessage}`);
  }
}

app.post("/generate-and-send", async (req, res) => {
  try {
    const { html, phoneNumber } = req.body;
    if (!html) {
      return res.status(400).json({ error: "HTML es requerido" });
    }
    const phone = phoneNumber || WHATSAPP_PHONE;
    if (!phone) {
      return res.status(400).json({ error: "Número de WhatsApp no configurado" });
    }
    const pngBuffer = await renderHtmlToPng(html);
    const result = await sendWhatsAppMessage(phone, pngBuffer);
    res.json({
      success: true,
      message: "Imagen generada y enviada correctamente",
      whatsappResponse: result,
    });
  } catch (error) {
    res.status(500).json({
      error: "Error procesando solicitud",
      details: error.message,
    });
  }
});

app.post("/generate-example", async (req, res) => {
  try {
    const exampleHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <style>
            body {
              font-family: Arial, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              height: 100vh;
              margin: 0;
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            }
            .container {
              background: white;
              padding: 40px;
              border-radius: 10px;
              text-align: center;
              box-shadow: 0 10px 25px rgba(0,0,0,0.2);
            }
            h1 { color: #333; margin: 0; }
            p { color: #666; margin-top: 10px; }
            .timestamp { color: #999; font-size: 12px; margin-top: 20px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🚀 Laboratorio Evolucion API</h1>
            <p>Imagen generada con Puppeteer</p>
            <div class="timestamp">${new Date().toLocaleString()}</div>
          </div>
        </body>
      </html>
    `;
    const { phoneNumber } = req.body;
    const phone = phoneNumber || WHATSAPP_PHONE;
    if (!phone) {
      return res.status(400).json({ error: "Número de WhatsApp no configurado" });
    }
    const pngBuffer = await renderHtmlToPng(exampleHtml);
    const result = await sendWhatsAppMessage(phone, pngBuffer);
    res.json({
      success: true,
      message: "Imagen de ejemplo generada y enviada",
      whatsappResponse: result,
    });
  } catch (error) {
    res.status(500).json({
      error: "Error procesando solicitud",
      details: error.message,
    });
  }
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", message: "API funcionando correctamente" });
});

app.listen(PORT, () => {
  console.log(`API escuchando en puerto ${PORT}`);
});

process.on("SIGINT", async () => {
  if (browser) await browser.close();
  process.exit(0);
});