import assert from 'node:assert/strict';
import test from 'node:test';
import { handler } from './handler.mjs';

function discoveryEvent(token = 'test-access-token') {
  return {
    directive: {
      header: {
        namespace: 'Alexa.Discovery',
        name: 'Discover',
        messageId: 'message-1',
        payloadVersion: '3'
      },
      payload: {
        scope: {
          type: 'BearerToken',
          token
        }
      }
    }
  };
}

function setEnvironment() {
  process.env.SPARARAMA_ALEXA_URL = 'https://example.test/api/alexa/direct';
  process.env.SPARARAMA_ALEXA_PROXY_SECRET = 'proxy-secret';
  process.env.ALEXA_SKILL_ID = 'amzn1.ask.skill.test';
  process.env.LWA_CLIENT_ID = 'lwa-client';
}

test('validates LWA token and strips it before forwarding to Spararama', { concurrency: false }, async () => {
  setEnvironment();
  const originalFetch = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).startsWith('https://api.amazon.com/auth/o2/tokeninfo')) {
      return {
        ok: true,
        async json() { return { aud: 'lwa-client' }; }
      };
    }
    return {
      ok: true,
      async text() { return JSON.stringify({ forwarded: true }); }
    };
  };

  try {
    const result = await handler(discoveryEvent());
    assert.deepEqual(result, { forwarded: true });
    assert.equal(calls.length, 2);
    const forwarded = JSON.parse(calls[1].options.body);
    assert.equal(forwarded.directive.payload.scope.token, undefined);
    assert.equal(calls[1].options.headers['X-Spararama-Alexa-Proxy-Secret'], 'proxy-secret');
    assert.equal(calls[1].options.headers['X-Spararama-Alexa-Skill-Id'], 'amzn1.ask.skill.test');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('returns INVALID_AUTHORIZATION_CREDENTIAL when LWA rejects the token', { concurrency: false }, async () => {
  setEnvironment();
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;

  globalThis.fetch = async () => {
    fetchCount += 1;
    return { ok: false, status: 400 };
  };

  try {
    const result = await handler(discoveryEvent('bad-token'));
    assert.equal(fetchCount, 1);
    assert.equal(result.event.header.namespace, 'Alexa');
    assert.equal(result.event.header.name, 'ErrorResponse');
    assert.equal(result.event.payload.type, 'INVALID_AUTHORIZATION_CREDENTIAL');
  } finally {
    globalThis.fetch = originalFetch;
  }
});
