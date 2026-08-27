import { VoiceMonkeySecretStore, type StoredVoiceMonkeyConfig } from './secret-manager';

const VOICE_MONKEY_ENDPOINT = 'https://api-v3.voicemonkey.io/announce';

export interface VoiceMonkeyStatus {
  enabled: boolean;
  configured: boolean;
  device?: string;
  chimeConfigured: boolean;
  source: 'secret-manager' | 'environment' | 'none';
  secretId: string;
  storageError?: string;
}

export interface VoiceMonkeySettingsInput {
  enabled?: boolean;
  token?: string;
  device?: string;
  chime?: string;
}

function environmentConfig(): StoredVoiceMonkeyConfig {
  return {
    enabled: String(process.env.VOICE_MONKEY_ENABLED || '').toLowerCase() === 'true',
    token: String(process.env.VOICE_MONKEY_TOKEN || '').trim(),
    device: String(process.env.VOICE_MONKEY_DEVICE || '').trim(),
    chime: String(process.env.VOICE_MONKEY_CHIME || '').trim()
  };
}

export class VoiceMonkeyService {
  private config = environmentConfig();
  private source: VoiceMonkeyStatus['source'] = this.config.token || this.config.device ? 'environment' : 'none';
  private storageError: string | undefined;
  private loadPromise: Promise<void> | null = null;

  constructor(private readonly secretStore = new VoiceMonkeySecretStore()) {}

  private ensureLoaded() {
    if (!this.loadPromise) this.loadPromise = this.loadSecretManagerConfig();
    return this.loadPromise;
  }

  private async loadSecretManagerConfig() {
    try {
      const stored = await this.secretStore.load();
      if (stored) {
        this.config = stored;
        this.source = 'secret-manager';
      }
      this.storageError = undefined;
    } catch (error: any) {
      this.storageError = error?.message || String(error);
      // Keep environment configuration as a backwards-compatible fallback.
    }
  }

  private currentStatus(): VoiceMonkeyStatus {
    return {
      enabled: this.config.enabled,
      configured: this.config.enabled && Boolean(this.config.token && this.config.device),
      device: this.config.device || undefined,
      chimeConfigured: Boolean(this.config.chime),
      source: this.source,
      secretId: this.secretStore.config.secretId,
      storageError: this.storageError
    };
  }

  async status() {
    await this.ensureLoaded();
    return this.currentStatus();
  }

  async configure(input: VoiceMonkeySettingsInput) {
    await this.ensureLoaded();
    const next: StoredVoiceMonkeyConfig = {
      enabled: input.enabled ?? this.config.enabled ?? true,
      token: String(input.token || '').trim() || this.config.token,
      device: input.device === undefined ? this.config.device : String(input.device).trim(),
      chime: input.chime === undefined || input.chime === '' ? this.config.chime : String(input.chime).trim()
    };

    if (next.enabled && !next.token) throw new Error('Voice Monkey API key is required.');
    if (next.enabled && !next.device) throw new Error('Voice Monkey device/monkey name is required.');

    await this.secretStore.save(next);
    this.config = next;
    this.source = 'secret-manager';
    this.storageError = undefined;
    return this.currentStatus();
  }

  async announce(speech: string) {
    await this.ensureLoaded();
    const status = this.currentStatus();
    if (!status.configured) {
      return { enabled: status.enabled, sent: false, error: status.enabled ? 'Voice Monkey API key/device not configured.' : undefined };
    }

    const body: Record<string, string> = {
      token: this.config.token,
      device: this.config.device,
      speech
    };
    if (this.config.chime) body.chime = this.config.chime;

    const response = await fetch(VOICE_MONKEY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`Voice Monkey announcement failed (${response.status}): ${responseText.slice(0, 300)}`);
    }
    return { enabled: true, sent: true };
  }
}
