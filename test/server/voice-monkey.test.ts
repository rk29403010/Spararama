import assert from 'node:assert/strict';
import test from 'node:test';
import { VoiceMonkeyService } from '../../server/alerts/voice-monkey';

function secretStore(config = { enabled: true, token: 'stored-token', device: 'old-speaker', chime: '' }) {
  let stored = { ...config };
  return {
    config: { projectId: 'test-project', secretId: 'test-secret' },
    load: async () => ({ ...stored }),
    save: async (next: typeof stored) => {
      stored = { ...next };
      return { projectId: 'test-project', secretId: 'test-secret' };
    },
    read: () => ({ ...stored })
  };
}

test('Voice Monkey speaker lookup uses a bearer token and returns friendly speaker choices only', async () => {
  const store = secretStore();
  let requestedUrl = '';
  let authorization = '';
  const request: typeof fetch = async (input, init) => {
    requestedUrl = String(input);
    authorization = new Headers(init?.headers).get('Authorization') || '';
    return new Response(JSON.stringify({
      success: true,
      data: [
        { id: 'routine-one', name: 'Heating routine', capability: 'routines' },
        { id: 'kitchen-echo', name: 'Kitchen Echo', capability: 'speakers' },
        { id: 'garden-echo', name: 'Garden Echo', capability: 'speakers' },
        { id: '', name: 'Broken', capability: 'speakers' }
      ]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  };

  const speakers = await new VoiceMonkeyService(store, request).listSpeakers('candidate-token');
  assert.equal(requestedUrl, 'https://api-v3.voicemonkey.io/devices');
  assert.equal(authorization, 'Bearer candidate-token');
  assert.deepEqual(speakers, [
    { id: 'garden-echo', name: 'Garden Echo' },
    { id: 'kitchen-echo', name: 'Kitchen Echo' }
  ]);
  assert.equal(store.read().token, 'stored-token');
});

test('Voice Monkey speaker lookup uses the stored token when no candidate is supplied', async () => {
  const store = secretStore();
  let authorization = '';
  const request: typeof fetch = async (_input, init) => {
    authorization = new Headers(init?.headers).get('Authorization') || '';
    return new Response(JSON.stringify({ success: true, data: [] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' }
    });
  };

  assert.deepEqual(await new VoiceMonkeyService(store, request).listSpeakers(), []);
  assert.equal(authorization, 'Bearer stored-token');
});

test('Voice Monkey errors are short and do not expose upstream response text', async () => {
  const store = secretStore();
  const request: typeof fetch = async () => new Response(JSON.stringify({
    error: 'INVALID_TOKEN',
    internal: 'do-not-forward-this-value'
  }), { status: 401, headers: { 'Content-Type': 'application/json' } });

  await assert.rejects(
    new VoiceMonkeyService(store, request).listSpeakers(),
    error => error instanceof Error
      && error.message === 'Voice Monkey rejected this API key.'
      && !error.message.includes('do-not-forward')
  );
});

test('Alexa configuration can clear a chime and remains configured while switched off', async () => {
  const store = secretStore({ enabled: true, token: 'stored-token', device: 'garden-echo', chime: 'old-chime' });
  const service = new VoiceMonkeyService(store);
  const status = await service.configure({ enabled: false, chime: '' });

  assert.equal(status.enabled, false);
  assert.equal(status.configured, true);
  assert.equal(status.tokenConfigured, true);
  assert.equal(status.chimeConfigured, false);
  assert.equal(store.read().chime, '');
});

test('a configured but disabled Alexa integration does not send announcements', async () => {
  const store = secretStore({ enabled: false, token: 'stored-token', device: 'garden-echo', chime: '' });
  let requests = 0;
  const request: typeof fetch = async () => {
    requests += 1;
    return new Response(JSON.stringify({ success: true }), { status: 200 });
  };

  assert.deepEqual(await new VoiceMonkeyService(store, request).announce('Test'), { enabled: false, sent: false });
  assert.equal(requests, 0);
});
