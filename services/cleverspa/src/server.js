import crypto from "node:crypto";
import http from "node:http";
import { config, isLoopbackAddress } from "./config.js";
import { SpaController } from "./spa/controller.js";

const controller = new SpaController();

function sendJson(response, statusCode, body) {
  const data = Buffer.from(JSON.stringify(body));
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": data.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(data);
}

function hasValidAccessToken(request) {
  if (!config.accessToken) return true;
  const supplied = request.headers.authorization?.replace(/^Bearer\s+/i, "") || "";
  const expectedBytes = Buffer.from(config.accessToken);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && crypto.timingSafeEqual(expectedBytes, suppliedBytes);
}

function credentialLoginAllowed(request) {
  return config.allowLanCredentialLogin || isLoopbackAddress(request.socket.remoteAddress);
}

async function readJson(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 32 * 1024) throw Object.assign(new Error("request body is too large"), { statusCode: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw Object.assign(new Error("request body must be valid JSON"), { statusCode: 400 }); }
}

async function handleApi(request, response, pathname) {
  if (!hasValidAccessToken(request)) {
    sendJson(response, 401, { error: "access token required", code: "unauthorized" });
    return;
  }

  if (request.method === "GET" && pathname === "/api/status") {
    sendJson(response, 200, await controller.status());
    return;
  }
  if (request.method === "GET" && pathname === "/api/info") {
    sendJson(response, 200, {
      service: "Spararama CleverSpa adapter",
      host: config.hostname,
      loopbackOnly: config.loopbackOnly,
      accessTokenRequired: Boolean(config.accessToken),
      capabilities: ["status", "discover", "heater", "filter", "bubbles", "target-temperature", "gizwits-cloud"],
    });
    return;
  }
  if (request.method !== "POST") {
    sendJson(response, 405, { error: "method not allowed" });
    return;
  }

  const body = await readJson(request);
  if (pathname === "/api/discover") {
    sendJson(response, 200, await controller.discover());
    return;
  }
  if (pathname === "/api/cloud/login" || pathname === "/api/cloud/token") {
    if (!credentialLoginAllowed(request)) {
      sendJson(response, 403, {
        error: "Gizwits credentials/tokens may only be entered from the adapter host unless LAN credential login is explicitly enabled",
        code: "loopback_required",
      });
      return;
    }
    if (pathname === "/api/cloud/login") await controller.connectCloud(body.username, body.password);
    else await controller.connectCloudToken(body.token);
    sendJson(response, 200, await controller.status());
    return;
  }
  if (pathname === "/api/control/heater") {
    sendJson(response, 200, await controller.controlHeater(Boolean(body.enabled)));
    return;
  }
  if (pathname === "/api/control/filter") {
    sendJson(response, 200, await controller.controlFilter(Boolean(body.enabled)));
    return;
  }
  if (pathname === "/api/control/bubbles") {
    sendJson(response, 200, await controller.controlBubbles(Boolean(body.enabled)));
    return;
  }
  if (pathname === "/api/control/target-temperature") {
    sendJson(response, 200, await controller.setTargetTemperature(Number(body.temperature)));
    return;
  }
  sendJson(response, 404, { error: "API route not found" });
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    if (url.pathname.startsWith("/api/")) await handleApi(request, response, url.pathname);
    else sendJson(response, 200, { service: "Spararama CleverSpa adapter", status: "ok", api: "/api/info" });
  } catch (error) {
    sendJson(response, error.statusCode || 500, {
      error: error.message || "internal server error",
      code: error.code || "server_error",
    });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`Spararama CleverSpa adapter: http://${config.host}:${config.port}`);
  if (config.loopbackOnly) console.log("Loopback-only mode is active (safe default).");
});

if (config.spaIp) {
  controller.connectLan(config.spaIp, config.spaPasscode).catch((error) => {
    console.error(`Initial LAN connection failed: ${error.message}`);
  });
}

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
