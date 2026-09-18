export const spararamaRuntime = String(import.meta.env.VITE_SPARARAMA_RUNTIME || 'local').trim().toLowerCase();

export const isCloudRuntime = spararamaRuntime === 'cloud';

export const cloudApiBaseUrl = String(import.meta.env.VITE_SPARARAMA_CLOUD_API_BASE || '')
  .trim()
  .replace(/\/$/, '');
