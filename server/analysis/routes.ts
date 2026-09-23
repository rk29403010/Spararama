import express, { type Express, type Request, type Response } from 'express';
import { GoogleGenAI, Type } from '@google/genai';
import type { LocalControlSecurity } from '../security/local-control';

const DEFAULT_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const HARD_MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DEFAULT_REQUESTS_PER_MINUTE = 6;
const RATE_WINDOW_MS = 60_000;

function boundedInteger(value: unknown, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

export function maxGeminiImageBytes() {
  return boundedInteger(
    process.env.GEMINI_ANALYSIS_MAX_IMAGE_BYTES,
    DEFAULT_MAX_IMAGE_BYTES,
    64 * 1024,
    HARD_MAX_IMAGE_BYTES
  );
}

export interface DecodedImage {
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp';
  base64: string;
  byteLength: number;
}

function matchesMagic(mimeType: DecodedImage['mimeType'], bytes: Buffer) {
  if (mimeType === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === 'image/png') {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value);
  }
  return bytes.length >= 12
    && bytes.subarray(0, 4).toString('ascii') === 'RIFF'
    && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
}

export function decodeImageDataUrl(value: unknown, maxBytes = maxGeminiImageBytes()): DecodedImage {
  if (typeof value !== 'string') throw new Error('Image must be supplied as a data URL.');
  const match = value.match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]*={0,2})$/);
  if (!match) throw new Error('Only JPEG, PNG or WebP image data URLs are accepted.');

  const mimeType = match[1] as DecodedImage['mimeType'];
  const rawBase64 = match[2];
  if (!rawBase64 || rawBase64.length % 4 === 1) throw new Error('Image base64 data is invalid.');

  const estimatedBytes = Math.floor(rawBase64.length * 3 / 4);
  if (estimatedBytes > maxBytes + 2) {
    throw new Error(`Image exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB decoded-image limit.`);
  }

  const paddedBase64 = rawBase64.padEnd(rawBase64.length + ((4 - rawBase64.length % 4) % 4), '=');
  const bytes = Buffer.from(paddedBase64, 'base64');
  if (!bytes.length || bytes.length > maxBytes) {
    throw new Error(`Image exceeds the ${Math.floor(maxBytes / (1024 * 1024))} MB decoded-image limit.`);
  }
  if (!matchesMagic(mimeType, bytes)) {
    throw new Error(`Image content does not match its declared ${mimeType} type.`);
  }

  return { mimeType, base64: bytes.toString('base64'), byteLength: bytes.length };
}

export class FixedWindowRateLimiter {
  private readonly windows = new Map<string, { startedAt: number; count: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs = RATE_WINDOW_MS
  ) {}

  consume(key: string, now = Date.now()) {
    const current = this.windows.get(key);
    if (!current || now - current.startedAt >= this.windowMs) {
      this.windows.set(key, { startedAt: now, count: 1 });
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (current.count >= this.limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((this.windowMs - (now - current.startedAt)) / 1000))
      };
    }
    current.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }
}

function analysisRateKey(req: Request, res: Response) {
  const uid = String(res.locals.localControlUid || '').trim();
  return uid ? `user:${uid}` : `local:${String(req.socket.remoteAddress || 'unknown')}`;
}

function analysisPrompt(type: unknown) {
  if (type === 'barcode') {
    return {
      prompt: 'Analyze this image and identify the hot tub or pool chemical. Return the name of the chemical, its primary active ingredient, and the quantity if visible. Return as a JSON object.',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          name: { type: Type.STRING },
          ingredientType: { type: Type.STRING },
          quantity: { type: Type.STRING }
        },
        required: ['name']
      }
    };
  }
  if (type === 'test_strip') {
    return {
      prompt: 'Analyze this hot tub test strip as an observation only. Identify Free Chlorine (or Bromine), pH, and Total Alkalinity. Return null for unreadable pads. Do not give dosing advice. Return JSON.',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          chlorine: { type: Type.NUMBER, description: 'Free chlorine ppm' },
          bromine: { type: Type.NUMBER, description: 'Bromine ppm' },
          ph: { type: Type.NUMBER, description: 'pH' },
          alkalinity: { type: Type.NUMBER, description: 'Total alkalinity ppm' }
        }
      }
    };
  }
  return null;
}

export function registerImageAnalysisRoutes(app: Express, security: LocalControlSecurity) {
  const maxImageBytes = maxGeminiImageBytes();
  // Base64 costs ~4/3 plus a small JSON envelope. This parser applies only to
  // the image route; normal API requests use the much smaller global JSON limit.
  const requestBodyLimit = Math.ceil(maxImageBytes * 4 / 3) + 64 * 1024;
  const rateLimit = boundedInteger(
    process.env.GEMINI_ANALYSIS_REQUESTS_PER_MINUTE,
    DEFAULT_REQUESTS_PER_MINUTE,
    1,
    60
  );
  const limiter = new FixedWindowRateLimiter(rateLimit);

  app.post(
    '/api/analyze-image',
    security.protectAuthenticatedOperation,
    express.json({ limit: requestBodyLimit }),
    async (req, res) => {
      const rate = limiter.consume(analysisRateKey(req, res));
      if (!rate.allowed) {
        res.setHeader('Retry-After', String(rate.retryAfterSeconds));
        res.status(429).json({ error: 'Too many image-analysis requests. Try again shortly.' });
        return;
      }

      const definition = analysisPrompt(req.body?.type);
      if (!definition) {
        res.status(400).json({ error: 'Invalid analysis type' });
        return;
      }

      let image: DecodedImage;
      try {
        image = decodeImageDataUrl(req.body?.imageBase64, maxImageBytes);
      } catch (error: any) {
        res.status(400).json({ error: error?.message || 'Invalid image data.' });
        return;
      }

      const apiKey = String(process.env.GEMINI_API_KEY || '').trim();
      if (!apiKey) {
        res.status(503).json({ error: 'Gemini API key not configured' });
        return;
      }

      try {
        const ai = new GoogleGenAI({
          apiKey,
          httpOptions: { headers: { 'User-Agent': 'aistudio-build' } }
        });
        const response = await ai.models.generateContent({
          model: 'gemini-2.5-flash',
          contents: {
            parts: [
              { inlineData: { mimeType: image.mimeType, data: image.base64 } },
              { text: definition.prompt }
            ]
          },
          config: {
            responseMimeType: 'application/json',
            responseSchema: definition.responseSchema
          }
        });

        const resultText = response.text || '{}';
        try {
          res.json(JSON.parse(resultText));
        } catch {
          res.json({ raw: resultText });
        }
      } catch (error: any) {
        console.error(error);
        res.status(502).json({ error: error?.message || 'Failed to analyze image' });
      }
    }
  );
}
