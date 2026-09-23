import 'dotenv/config';
import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import { createSpaAdapter } from './server/spa/factory';
import { registerSpaRoutes } from './server/spa/routes';
import { BestEffortTemperatureResolver } from './server/spa/temperature';
import { BubbleSessionManager, bubblePolicyForAdapter } from './server/spa/bubbles';
import { TelemetryCollector } from './server/telemetry/collector';
import { FirebaseTelemetrySink } from './server/telemetry/firebase-sink';
import { LocalTelemetryStore } from './server/telemetry/local-store';
import { SharedTelemetryStore } from './server/telemetry/shared-store';
import { TelemetrySettingsStore } from './server/telemetry/settings';
import { registerSpaHistoryRoutes } from './server/history/spa-events';
import { LocalFirstWeatherService } from './server/weather/local-first';
import { registerWeatherRoutes } from './server/weather/routes';
import { HeatingPlanner } from './server/heating/planner';
import { HeatingScheduler } from './server/heating/scheduler';
import { HeatingStore } from './server/heating/store';
import { registerHeatingRoutes } from './server/heating/routes';
import { PushService } from './server/push/service';
import { registerPushRoutes } from './server/push/routes';
import { AlexaAlertDispatcher } from './server/alerts/alexa-dispatcher';
import { registerAlertRoutes } from './server/alerts/routes';
import { AlexaSpaCommandService } from './server/alexa/direct';
import { registerDirectAlexaRoutes } from './server/alexa/routes';
import { createMerossMsh300SensorSource } from './server/sensors/meross-msh300';
import { createEcowittLanIntegration } from './server/sensors/ecowitt';
import { combineSensorSources } from './server/sensors/composite';
import { registerSystemUpdateRoutes } from './server/system/update';
import { createRemoteRuntime } from './server/remote/factory';
import { registerLocalControlSecurity } from './server/security/local-control';
import { registerImageAnalysisRoutes } from './server/analysis/routes';

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT || 3000);
  const HOST = process.env.SPAR_BIND_HOST || '127.0.0.1';

  const isTermux = String(process.env.PREFIX || '').includes('com.termux');
  if (isTermux && (!process.env.TELEMETRY_HOST_ID || process.env.TELEMETRY_HOST_ID === 'spararama-laptop')) {
    process.env.TELEMETRY_HOST_ID = 'spararama-phone';
  }

  app.use((_req, res, next) => {
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    res.setHeader('Content-Security-Policy', "frame-ancestors 'none'");
    res.setHeader('X-Frame-Options', 'DENY');
    next();
  });

  // Physical-control mutations are safe on direct loopback and require an
  // authenticated owner/member session when reached from another LAN device.
  // The same role/session boundary protects push registration and billable image
  // analysis before their request bodies are parsed.
  const localControlSecurity = registerLocalControlSecurity(app);
  const pushService = new PushService();
  registerPushRoutes(app, pushService, localControlSecurity);
  registerImageAnalysisRoutes(app, localControlSecurity);

  // Ordinary JSON API requests should never need the old 50 MB global allowance.
  // Large image analysis and tiny push registration bodies have route-specific
  // parsers registered above with their own limits.
  app.use(express.json({ limit: "1mb" }));

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

  const ecowitt = createEcowittLanIntegration();
  const weather = new LocalFirstWeatherService(ecowitt?.weatherSource);
  const merossSensors = createMerossMsh300SensorSource();
  const environmentalSensors = combineSensorSources(merossSensors, ecowitt?.sensorSource);
  const temperatureResolver = new BestEffortTemperatureResolver(spaAdapter, telemetryStore);
  const heatingScheduler = new HeatingScheduler(spaAdapter, new HeatingStore(), pushService);
  const heatingPlanner = new HeatingPlanner(spaAdapter, heatingScheduler, weather);
  const alexaDirect = new AlexaSpaCommandService(spaAdapter, bubbles, heatingScheduler, { weatherService: weather });
  const remoteRuntime = createRemoteRuntime({
    spa: spaAdapter,
    bubbles,
    heating: heatingScheduler,
    heatingPlanner
  });
  registerSpaRoutes(app, spaAdapter, temperatureResolver, bubbles);
  registerWeatherRoutes(app, weather);
  registerHeatingRoutes(app, heatingScheduler, heatingPlanner);
  registerAlertRoutes(app, alexaAlerts, localControlSecurity);
  registerDirectAlexaRoutes(app, alexaDirect);
  registerSpaHistoryRoutes(app);
  registerSystemUpdateRoutes(app);

  const telemetry = new TelemetryCollector(spaAdapter, telemetryStore, firebaseTelemetry, weather, environmentalSensors);
  const telemetrySettingsStore = new TelemetrySettingsStore();
  const telemetrySettings = await telemetrySettingsStore.load();
  telemetry.setIntervalSeconds(telemetrySettings.intervalSeconds);
  telemetry.start();
  if (firebaseTelemetry.enabled) {
    // Register only this active collector. Historical collector documents and
    // samples remain intact, but old hosts are no longer refreshed indefinitely.
    const identity = telemetry.getIdentity();
    void firebaseTelemetry.registerCollector(identity.hostId, identity.collectorVersion).catch((error: any) => {
      console.warn(`Could not register this telemetry collector with Firebase: ${error?.message || String(error)}`);
    });
  }

  // Event-capable adapters can provide an immediate observation. Feed that exact
  // status into telemetry instead of re-reading the spa, otherwise a status event
  // would trigger another status request and recursively generate more events.
  const unsubscribeSpaEvents = spaAdapter.subscribe?.((event) => {
    if (event.kind === 'status') void telemetry.collectNow(event.status);
  });

  heatingScheduler.start();
  alexaAlerts.start();
  bubbles.start();
  await remoteRuntime.agent.start();
  remoteRuntime.publisher?.start();
  void sharedTelemetry.refresh();
  const telemetryStatus = telemetry.getStatus();
  console.log(`Firebase telemetry enabled: ${telemetryStatus.firebaseEnabled}`);
  console.log(`Firebase project: ${telemetryStatus.firebaseProjectId || 'not resolved'}`);
  console.log(`Firestore database: ${telemetryStatus.firestoreDatabaseId || 'not resolved'}`);
  console.log(`Firebase credential source: ${telemetryStatus.firebaseCredentialSource || 'not resolved'}`);
  console.log(`Background push enabled: ${pushService.enabled}`);
  console.log(`Telemetry collector ID: ${process.env.TELEMETRY_HOST_ID || 'machine hostname'}`);
  console.log(`Meross MSH300 sensor polling: ${merossSensors ? `enabled (${merossSensors.config.endpoint.host})` : 'disabled'}`);
  console.log(`Ecowitt LAN weather: ${ecowitt ? `enabled (${ecowitt.client.config.endpoint.host})` : 'disabled'}`);
  console.log(`Remote transport: ${remoteRuntime.config.configuredTransport} (${remoteRuntime.config.transport === 'none' ? 'disabled' : 'enabled'})`);
  if (remoteRuntime.config.warning) console.warn(remoteRuntime.config.warning);

  const combinedTelemetryStatus = () => ({
    ...telemetry.getStatus(),
    collectorHostId: process.env.TELEMETRY_HOST_ID || 'machine-hostname',
    sharedHistory: sharedTelemetry.getStatus(),
    localSensors: {
      merossConfigured: Boolean(merossSensors),
      ecowitt: ecowitt?.client.getStatus() ?? { configured: false }
    }
  });

  app.get("/api/health", (_req, res) => {
    res.json({
      status: "ok",
      spaAdapter: process.env.SPA_ADAPTER || 'bridge',
      telemetry: combinedTelemetryStatus(),
      remote: remoteRuntime.agent.getStatus()
    });
  });

  app.get('/api/telemetry/status', (_req, res) => {
    res.json(combinedTelemetryStatus());
  });

  app.get('/api/telemetry/config', (_req, res) => {
    res.json({ intervalSeconds: telemetry.getStatus().intervalMs / 1000, managedBy: 'system' });
  });

  app.put('/api/telemetry/config', (_req, res) => {
    res.status(409).json({
      error: 'Telemetry polling is managed automatically by Spararama.',
      intervalSeconds: telemetry.getStatus().intervalMs / 1000,
      managedBy: 'system'
    });
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
      const until = Number(req.query.until || Date.now());
      const maxPoints = Number(req.query.maxPoints || 500);
      if (!Number.isFinite(since) || !Number.isFinite(until) || until < since) {
        res.status(400).json({ error: 'Expected numeric chart range with until >= since' });
        return;
      }
      res.json(await sharedTelemetry.readChartRange(since, maxPoints, until));
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

  const server = app.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
    console.log(`Telemetry watchdog every ${telemetry.getStatus().intervalMs / 1000}s -> ${telemetry.getStatus().localArchivePath}`);
  });

  const shutdown = () => {
    unsubscribeSpaEvents?.();
    telemetry.stop();
    heatingScheduler.stop();
    alexaAlerts.stop();
    bubbles.stop();
    remoteRuntime.publisher?.stop();
    void remoteRuntime.agent.stop();
    server.close(() => process.exit(0));
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

startServer();
