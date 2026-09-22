const UPDATE_EVENT = 'spararama:pwa-update-ready';
const UPDATE_INTERVAL_MS = 60 * 60 * 1000;

let registration: ServiceWorkerRegistration | null = null;
let reloadAfterActivation = false;

function announceWaitingWorker(candidate: ServiceWorkerRegistration) {
  if (candidate.waiting && navigator.serviceWorker.controller) {
    window.dispatchEvent(new Event(UPDATE_EVENT));
  }
}

export function subscribeToPwaUpdates(listener: () => void) {
  window.addEventListener(UPDATE_EVENT, listener);
  if (registration) queueMicrotask(() => announceWaitingWorker(registration!));
  return () => window.removeEventListener(UPDATE_EVENT, listener);
}

export function applyPwaUpdate() {
  if (!registration?.waiting) return false;
  reloadAfterActivation = true;
  registration.waiting.postMessage({ type: 'SKIP_WAITING' });
  return true;
}

export function registerPwaServiceWorker() {
  if (import.meta.env.DEV || !('serviceWorker' in navigator)) return;

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(candidate => {
      registration = candidate;
      announceWaitingWorker(candidate);

      candidate.addEventListener('updatefound', () => {
        const worker = candidate.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed') announceWaitingWorker(candidate);
        });
      });

      const checkForUpdate = () => {
        if (document.visibilityState === 'visible' && navigator.onLine) {
          void candidate.update().catch(() => undefined);
        }
      };
      document.addEventListener('visibilitychange', checkForUpdate);
      window.addEventListener('online', checkForUpdate);
      window.setInterval(checkForUpdate, UPDATE_INTERVAL_MS);
    }).catch(error => {
      console.warn('Spararama service worker registration failed:', error);
    });
  });

  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloadAfterActivation) window.location.reload();
  });
}
