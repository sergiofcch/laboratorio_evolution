import puppeteer from "puppeteer";
import axios from "axios";
import express from "express";

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;
const EVOLUCION_API_URL = process.env.EVOLUCION_API_URL;
const EVOLUCION_API_KEY = process.env.EVOLUCION_API_KEY;
const WHATSAPP_PHONE = process.env.WHATSAPP_PHONE;

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

async function sendWhatsAppMessage(phoneNumber, imageBuffer) {
  const base64Image = imageBuffer.toString("base64");
  const response = await axios.post(
    `${EVOLUCION_API_URL}/message/sendImage`,
    {
      number: phoneNumber,
      image: {
        imageBase64: base64Image,
        caption: "Imagen generada desde laboratorio",
      },
    },
    {
      headers: {
        Authorization: `Bearer ${EVOLUCION_API_KEY}`,
        "Content-Type": "application/json",
      },
    }
  );
  return response.data;
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