import http from 'node:http';

const host = '127.0.0.1';
const port = Number(process.env.PORT || 3001);
const target = String(
  process.env.SPARARAMA_LOCAL_URL || 'http://127.0.0.1:3000/api/alexa/direct'
).trim();
const maxBodyBytes = 256 * 1024;

function write(res, statusCode, body, contentType = 'text/plain; charset=utf-8') {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new Error('Request body is too large.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/health') {
    write(res, 200, 'ok');
    return;
  }

  if (req.method !== 'POST' || req.url !== '/api/alexa/direct') {
    write(res, 404, 'Not found');
    return;
  }

  try {
    const body = await readBody(req);
    const upstream = await fetch(target, {
      method: 'POST',
      headers: {
        'Content-Type': req.headers['content-type'] || 'application/json',
        'X-Spararama-Alexa-Proxy-Secret': req.headers['x-spararama-alexa-proxy-secret'] || '',
        'X-Spararama-Alexa-Skill-Id': req.headers['x-spararama-alexa-skill-id'] || ''
      },
      body,
      signal: AbortSignal.timeout(7500)
    });

    const responseBody = await upstream.text();
    write(
      res,
      upstream.status,
      responseBody,
      upstream.headers.get('content-type') || 'application/json; charset=utf-8'
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    write(res, 502, `Alexa proxy error: ${message}`);
  }
});

server.listen(port, host, () => {
  console.log(`Spararama Alexa-only proxy listening on http://${host}:${port}`);
  console.log(`Forwarding POST /api/alexa/direct to ${target}`);
});
