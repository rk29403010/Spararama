import 'dotenv/config';
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI, Type } from "@google/genai";
import { createSpaAdapter } from './server/spa/factory';
import { registerSpaRoutes } from './server/spa/routes';
import { BestEffortTemperatureResolver } from './server/spa/temperature';
import { BubbleSessionManager, bubblePolicyForAdapter } from './server/spa/bubbles';
import { TelemetryCollector } from './server/telemetry/collector';
import { FirebaseTelemetrySink } from './server/telemetry/firebase-sink';
import { LocalTelemetryStore } from './server/telemetry/local-store';
import { SharedTelemetryStore } from './server/telemetry/shared-store';
import { TelemetrySettingsStore, validateTelemetryIntervalSeconds } from './server/telemetry/settings';
import { registerSpaHistoryRoutes } from './server/history/spa-events';
import { WeatherService } from './server/weather/service';
import { registerWeatherRoutes } from './server/weather/routes';
import { HeatingScheduler } from './server/heating/scheduler';
import { registerHeatingRoutes } from './server/heating/routes';
import { AlexaAlertDispatcher } from './server/alerts/alexa-dispatcher';
import { registerAlertRoutes } from './server/alerts/routes';

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);

  // A whole .env is often copied from a development laptop onto the Termux host.
  // Do not let the example laptop collector ID make two independent event streams
  // look like one machine. Explicit non-example IDs are respected.
  const isTermux = String(process.env.PREFIX || '').includes('com.termux');
  if (isTermux && (!process.env.TELEMETRY_HOST_ID || process.env.TELEMETRY_HOST_ID === 'spararama-laptop')) {
    process.env.TELEMETRY_HOST_ID = 'spararama-phone';
  }

  app.use((_req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    next();
  });
  app.use(express.json({ limit: "50mb" }));

  const spaAdapter = createSpaAdapter();
  const alexaAlerts = new AlexaAlertDispatcher();
  const bubbles = new BubbleSessionManager(
    spaAdapter,
    bubblePolicyForAdapter(),
    text => alexaAlerts.announce(text)
  );
  const telemetryStore = new LocalTelemetryStore();
  const telemetryMigration = await telemetryStore.compactLegacyTelemetry();
  if (telemetryMigration.archive.migrated || telemetryMigration.pending.migrated) {
    console.log(
      `Compacted legacy telemetry: archive ${telemetryMigration.archive.before} -> ${telemetryMigration.archive.after}, `
      + `pending ${telemetryMigration.pending.before} -> ${telemetryMigration.pending.after}`
    );
  }

  const firebaseTelemetry = new FirebaseTelemetrySink();
  const sharedTelemetry = new SharedTelemetryStore(telemetryStore, firebaseTelemetry);
  if (firebaseTelemetry.enabled) {
    try {
      const localRecords = await telemetryStore.readArchiveRecords();
      const localCollectors = new Map<string, string>();
      for (const record of localRecords) localCollectors.set(record.hostId, record.collectorVersion);
      await Promise.all(Array.from(localCollectors.entries()).map(([hostId, version]) => firebaseTelemetry.registerCollector(hostId, version)));
    } catch (error: any) {
      console.warn(`Could not register local telemetry collectors with Firebase: ${error?.message || String(error)}`);
    }
  }

  const weather = new WeatherService();
  const temperatureResolver = new BestEffortTemperatureResolver(spaAdapter, telemetryStore);
  const heatingScheduler = new HeatingScheduler(spaAdapter);
  registerSpaRoutes(app, spaAdapter, temperatureResolver, bubbles);
  registerWeatherRoutes(app, weather);
  registerHeatingRoutes(app, heatingScheduler);
  registerAlertRoutes(app, alexaAlerts);
  registerSpaHistoryRoutes(app);

  const telemetry = new TelemetryCollector(spaAdapter, telemetryStore, firebaseTelemetry, weather);
  const telemetrySettingsStore = new TelemetrySettingsStore();
  const telemetrySettings = await telemetrySettingsStore.load();
  telemetry.setIntervalSeconds(telemetrySettings.intervalSeconds);
  telemetry.start();
  heatingScheduler.start();
  alexaAlerts.start();
  bubbles.start();
  void sharedTelemetry.refresh();
  const telemetryStatus = telemetry.getStatus();
  console.log(`Firebase telemetry enabled: ${telemetryStatus.firebaseEnabled}`);
  console.log(`Firebase project: ${telemetryStatus.firebaseProjectId || 'not resolved'}`);
  console.log(`Firestore database: ${telemetryStatus.firestoreDatabaseId || 'not resolved'}`);
  console.log(`Firebase credential source: ${telemetryStatus.firebaseCredentialSource || 'not resolved'}`);
  console.log(`Telemetry collector ID: ${process.env.TELEMETRY_HOST_ID || 'machine hostname'}`);

  const combinedTelemetryStatus = () => ({
    ...telemetry.getStatus(),
    collectorHostId: process.env.TELEMETRY_HOST_ID || 'machine-hostname',
    sharedHistory: sharedTelemetry.getStatus()
  });

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      spaAdapter: process.env.SPA_ADAPTER || 'bridge',
      telemetry: combinedTelemetryStatus()
    });
  });

  app.get('/api/telemetry/status', (_req, res) => {
    res.json(combinedTelemetryStatus());
  });

  app.get('/api/telemetry/config', (_req, res) => {
    res.json({ intervalSeconds: telemetry.getStatus().intervalMs / 1000 });
  });

  app.put('/api/telemetry/config', async (req, res) => {
    try {
      const intervalSeconds = validateTelemetryIntervalSeconds(req.body?.intervalSeconds);
      await telemetrySettingsStore.save({ intervalSeconds });
      telemetry.setIntervalSeconds(intervalSeconds);
      res.json({ intervalSeconds });
    } catch (error: any) {
      res.status(400).json({ error: error?.message || 'Invalid telemetry configuration' });
    }
  });

  app.get('/api/telemetry/samples', async (req, res) => {
    try {
      const requestedLimit = Number(req.query.limit || 200);
      const limit = Number.isFinite(requestedLimit) ? requestedLimit : 200;
      res.json(await sharedTelemetry.readRecent(limit));
    } catch (error: any) {
      res.status(500).json({ error: error?.message || 'Unable to read shared telemetry history' });
    }
  });

  app.get('/api/telemetry/chart', async (req, res) => {
    try {
      const since = Number(req.query.since || Date.now() - 48 * 60 * 60 * 1000);
      const maxPoints = Number(req.query.maxPoints || 500);
      if (!Number.isFinite(since)) {
        res.status(400).json({ error: 'Expected numeric query parameter: since' });
        return;
      }
      res.json(await sharedTelemetry.readChartRange(since, maxPoints));
    } catch (error: any) {
      res.status(500).json({ error: error?.message || 'Unable to prepare shared telemetry chart history' });
    }
  });

  app.post('/api/telemetry/refresh', async (_req, res) => {
    res.json(await sharedTelemetry.refresh());
  });

  app.post('/api/telemetry/collect-now', async (_req, res) => {
    await telemetry.collectNow();
    res.json(combinedTelemetryStatus());
  });

  app.post('/api/telemetry/flush', async (_req, res) => {
    await telemetry.flushPending();
    res.json(combinedTelemetryStatus());
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
    heatingScheduler.stop();
    alexaAlerts.stop();
    bubbles.stop();
    server.close(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

startServer();
