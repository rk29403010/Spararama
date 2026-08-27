import { applicationDefault } from 'firebase-admin/app';

const DEFAULT_PROJECT_ID = 'microprojects-481213';
const DEFAULT_SECRET_ID = 'spararama-voice-monkey';
const SECRET_MANAGER_ROOT = 'https://secretmanager.googleapis.com/v1';

export interface StoredVoiceMonkeyConfig {
  enabled: boolean;
  token: string;
  device: string;
  chime: string;
}

export interface SecretManagerConfig {
  projectId: string;
  secretId: string;
}

export function resolveSecretManagerConfig(): SecretManagerConfig {
  return {
    projectId: String(process.env.FIREBASE_PROJECT_ID || DEFAULT_PROJECT_ID).trim(),
    secretId: String(process.env.VOICE_MONKEY_SECRET_ID || DEFAULT_SECRET_ID).trim()
  };
}

export class VoiceMonkeySecretStore {
  readonly config = resolveSecretManagerConfig();
  private readonly credential = applicationDefault();

  private secretName() {
    return `projects/${this.config.projectId}/secrets/${this.config.secretId}`;
  }

  private async headers(includeJson = false) {
    const token = await this.credential.getAccessToken();
    return {
      Authorization: `Bearer ${token.access_token}`,
      ...(includeJson ? { 'Content-Type': 'application/json' } : {})
    };
  }

  private async errorFor(response: Response, fallback: string) {
    const body = await response.json().catch(() => null) as any;
    return new Error(body?.error?.message || `${fallback} (${response.status})`);
  }

  async load(): Promise<StoredVoiceMonkeyConfig | null> {
    const response = await fetch(`${SECRET_MANAGER_ROOT}/${this.secretName()}/versions/latest:access`, {
      headers: await this.headers()
    });
    if (response.status === 404) return null;
    if (!response.ok) throw await this.errorFor(response, 'Unable to read Voice Monkey secret');

    const body = await response.json() as any;
    const encoded = String(body?.payload?.data || '');
    if (!encoded) return null;
    const parsed = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8'));
    return {
      enabled: parsed?.enabled !== false,
      token: String(parsed?.token || '').trim(),
      device: String(parsed?.device || '').trim(),
      chime: String(parsed?.chime || '').trim()
    };
  }

  private async addVersion(headers: Record<string, string>, payload: string) {
    return fetch(`${SECRET_MANAGER_ROOT}/${this.secretName()}:addVersion`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ payload: { data: payload } })
    });
  }

  async save(config: StoredVoiceMonkeyConfig) {
    const headers = await this.headers(true);
    const payload = Buffer.from(JSON.stringify(config), 'utf8').toString('base64');
    let response = await this.addVersion(headers, payload);

    if (response.status === 404) {
      const create = await fetch(`${SECRET_MANAGER_ROOT}/projects/${this.config.projectId}/secrets?secretId=${encodeURIComponent(this.config.secretId)}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ replication: { automatic: {} } })
      });
      if (!create.ok && create.status !== 409) {
        throw await this.errorFor(create, 'Unable to create Voice Monkey secret');
      }
      response = await this.addVersion(headers, payload);
    }

    if (!response.ok) throw await this.errorFor(response, 'Unable to save Voice Monkey secret');
    return { projectId: this.config.projectId, secretId: this.config.secretId };
  }
}
