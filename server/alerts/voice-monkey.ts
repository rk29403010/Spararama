const VOICE_MONKEY_ENDPOINT = 'https://api-v3.voicemonkey.io/announce';

export interface VoiceMonkeyStatus {
  enabled: boolean;
  configured: boolean;
  device?: string;
  chimeConfigured: boolean;
}

export function resolveVoiceMonkeyConfig() {
  const enabled = String(process.env.VOICE_MONKEY_ENABLED || '').toLowerCase() === 'true';
  const token = String(process.env.VOICE_MONKEY_TOKEN || '').trim();
  const device = String(process.env.VOICE_MONKEY_DEVICE || '').trim();
  const chime = String(process.env.VOICE_MONKEY_CHIME || '').trim();
  return { enabled, token, device, chime };
}

export class VoiceMonkeyService {
  private readonly config = resolveVoiceMonkeyConfig();

  status(): VoiceMonkeyStatus {
    return {
      enabled: this.config.enabled,
      configured: this.config.enabled && Boolean(this.config.token && this.config.device),
      device: this.config.device || undefined,
      chimeConfigured: Boolean(this.config.chime)
    };
  }

  async announce(speech: string) {
    const status = this.status();
    if (!status.configured) {
      return { enabled: status.enabled, sent: false, error: status.enabled ? 'Voice Monkey token/device not configured.' : undefined };
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
