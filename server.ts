import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import { createSpaAdapter } from './server/spa/factory';
import { registerSpaRoutes } from './server/spa/routes';
import { TelemetryCollector } from './server/telemetry/collector';

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  app.use(express.json({ limit: "50mb" }));

  const spaAdapter = createSpaAdapter();
  registerSpaRoutes(app, spaAdapter);

  const telemetry = new TelemetryCollector(spaAdapter);
  telemetry.start();

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      spaAdapter: process.env.SPA_ADAPTER || 'bridge',
      telemetry: telemetry.getStatus()
    });
  });

  app.get('/api/telemetry/status', (_req, res) => {
    res.json(telemetry.getStatus());
  });

  app.post('/api/telemetry/collect-now', async (_req, res) => {
    await telemetry.collectNow();
    res.json(telemetry.getStatus());
  });

  app.post('/api/telemetry/flush', async (_req, res) => {
    await telemetry.flushPending();
    res.json(telemetry.getStatus());
  });

  // AI remains optional and observation-only. It is not used by the deterministic
  // chemistry rules engine or by spa control decisions.
  app.post("/api/analyze-image", async (req, res) => {
    try {
      const { imageBase64, type } = req.body;
      if (!imageBase64) {
        return res.status(400).json({ error: "No image provided" });
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        return res.status(500).json({ error: "Gemini API key not configured" });
      }

      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: {
          headers: { 'User-Agent': 'aistudio-build' }
        }
      });

      let prompt = "";
      let responseSchema: any = null;

      if (type === "barcode") {
        prompt = "Analyze this image and identify the hot tub or pool chemical. Return the name of the chemical, its primary active ingredient, and the quantity if visible. Return as a JSON object.";
        responseSchema = {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            ingredientType: { type: Type.STRING },
            quantity: { type: Type.STRING }
          },
          required: ["name"]
        };
      } else if (type === "test_strip") {
        prompt = "Analyze this hot tub test strip as an observation only. Identify Free Chlorine (or Bromine), pH, and Total Alkalinity. Return null for unreadable pads. Do not give dosing advice. Return JSON.";
        responseSchema = {
          type: Type.OBJECT,
          properties: {
            chlorine: { type: Type.NUMBER, description: "Free chlorine ppm" },
            bromine: { type: Type.NUMBER, description: "Bromine ppm" },
            ph: { type: Type.NUMBER, description: "pH" },
            alkalinity: { type: Type.NUMBER, description: "Total alkalinity ppm" }
          }
        };
      } else {
        return res.status(400).json({ error: "Invalid analysis type" });
      }

      const base64Data = imageBase64.replace(/^data:image\/\w+;base64,/, "");
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: {
          parts: [
            { inlineData: { mimeType: "image/jpeg", data: base64Data } },
            { text: prompt }
          ]
        },
        config: {
          responseMimeType: "application/json",
          responseSchema
        }
      });

      const resultText = response.text || "{}";
      try {
        res.json(JSON.parse(resultText));
      } catch {
        res.json({ raw: resultText });
      }
    } catch (err: any) {
      console.error(err);
      res.status(500).json({ error: err.message || "Failed to analyze image" });
    }
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Telemetry every ${telemetry.getStatus().intervalMs / 1000}s -> ${telemetry.getStatus().localArchivePath}`);
  });

  const shutdown = () => {
    telemetry.stop();
    server.close(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

startServer();
