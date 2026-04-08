import puppeteer from "puppeteer";
import axios from "axios";
import express from "express";
import { S3Client, PutObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

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

  const signedUrl = await getSignedUrl(
    s3Client,
    new GetObjectCommand({ Bucket: S3_BUCKET, Key: filename }),
    { expiresIn: 3600 }
  );

  return signedUrl;
}

async function sendWhatsAppMessage(phoneNumber, imageBuffer) {
  // Normalize phone number to full international format (digits only, with country code).
  // Accepts: "3143607930", "+573143607930", "573143607930" → "573143607930"
  let normalizedPhone = String(phoneNumber).replace(/\D/g, "");
  if (!normalizedPhone.startsWith("57") || normalizedPhone.length <= 10) {
    // No country code present — prepend Colombia's country code
    normalizedPhone = "57" + normalizedPhone;
  }

  const s3Url = await uploadImageToS3(imageBuffer);
  const imageUrl = s3Url;

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
    // Generate 6 unique random lottery numbers between 1 and 99
    const lotteryNumbers = [];
    while (lotteryNumbers.length < 6) {
      const n = Math.floor(Math.random() * 99) + 1;
      if (!lotteryNumbers.includes(n)) lotteryNumbers.push(n);
    }
    lotteryNumbers.sort((a, b) => a - b);

    const ballColors = [
      { bg: "#e63946", shadow: "#9b1a24" },
      { bg: "#f4a261", shadow: "#b5621a" },
      { bg: "#2a9d8f", shadow: "#1a6b61" },
      { bg: "#264653", shadow: "#0f1e24" },
      { bg: "#e9c46a", shadow: "#b08a1a" },
      { bg: "#6a4c93", shadow: "#3d1f6b" },
    ];

    const ballsHtml = lotteryNumbers
      .map(
        (num, i) => `
        <div class="ball" style="
          background: radial-gradient(circle at 35% 35%, ${ballColors[i].bg}cc, ${ballColors[i].bg});
          box-shadow: 4px 4px 12px ${ballColors[i].shadow}99, inset -3px -3px 8px rgba(0,0,0,0.25), inset 3px 3px 8px rgba(255,255,255,0.3);
        ">
          <span>${String(num).padStart(2, "0")}</span>
        </div>`
      )
      .join("");

    const drawDate = new Date().toLocaleString("es-CO", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    const exampleHtml = `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="UTF-8" />
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body {
              font-family: "Arial Black", Arial, sans-serif;
              display: flex;
              justify-content: center;
              align-items: center;
              min-height: 100vh;
              background: linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%);
            }
            .card {
              background: linear-gradient(160deg, #1a1a2e 0%, #16213e 60%, #0f3460 100%);
              border: 2px solid rgba(255, 215, 0, 0.4);
              border-radius: 24px;
              padding: 48px 56px 40px;
              text-align: center;
              box-shadow:
                0 0 60px rgba(255, 215, 0, 0.15),
                0 20px 60px rgba(0, 0, 0, 0.6);
              max-width: 780px;
              width: 100%;
            }
            .badge {
              display: inline-block;
              background: linear-gradient(90deg, #f7971e, #ffd200);
              color: #1a1a2e;
              font-size: 11px;
              font-weight: 900;
              letter-spacing: 3px;
              text-transform: uppercase;
              padding: 5px 18px;
              border-radius: 20px;
              margin-bottom: 18px;
            }
            .title {
              font-size: 42px;
              font-weight: 900;
              letter-spacing: 4px;
              text-transform: uppercase;
              background: linear-gradient(90deg, #ffd200, #f7971e, #ffd200);
              -webkit-background-clip: text;
              -webkit-text-fill-color: transparent;
              background-clip: text;
              margin-bottom: 6px;
              text-shadow: none;
            }
            .subtitle {
              font-size: 16px;
              color: rgba(255, 255, 255, 0.55);
              letter-spacing: 2px;
              text-transform: uppercase;
              margin-bottom: 40px;
            }
            .divider {
              width: 60px;
              height: 3px;
              background: linear-gradient(90deg, #f7971e, #ffd200);
              border-radius: 2px;
              margin: 0 auto 40px;
            }
            .balls-row {
              display: flex;
              justify-content: center;
              gap: 20px;
              flex-wrap: wrap;
              margin-bottom: 40px;
            }
            .ball {
              width: 90px;
              height: 90px;
              border-radius: 50%;
              display: flex;
              align-items: center;
              justify-content: center;
              position: relative;
            }
            .ball span {
              font-size: 30px;
              font-weight: 900;
              color: #ffffff;
              text-shadow: 1px 2px 4px rgba(0,0,0,0.5);
              letter-spacing: -1px;
            }
            .footer-divider {
              width: 100%;
              height: 1px;
              background: rgba(255, 215, 0, 0.2);
              margin-bottom: 20px;
            }
            .draw-info {
              display: flex;
              justify-content: space-between;
              align-items: center;
              flex-wrap: wrap;
              gap: 8px;
            }
            .draw-label {
              font-size: 11px;
              letter-spacing: 2px;
              text-transform: uppercase;
              color: rgba(255, 255, 255, 0.35);
            }
            .draw-date {
              font-size: 13px;
              color: rgba(255, 215, 0, 0.75);
              font-weight: 700;
              letter-spacing: 1px;
              text-transform: capitalize;
            }
            .draw-id {
              font-size: 12px;
              color: rgba(255, 255, 255, 0.35);
              letter-spacing: 1px;
            }
          </style>
        </head>
        <body>
          <div class="card">
            <div class="badge">🏆 Resultado Oficial</div>
            <div class="title">Sorteo de Lotería</div>
            <div class="subtitle">Lotería Nacional · Gran Premio</div>
            <div class="divider"></div>
            <div class="balls-row">
              ${ballsHtml}
            </div>
            <div class="footer-divider"></div>
            <div class="draw-info">
              <div class="draw-label">📅 Fecha del sorteo</div>
              <div class="draw-date">${drawDate}</div>
              <div class="draw-id">Sorteo #${Math.floor(Math.random() * 9000) + 1000}</div>
            </div>
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