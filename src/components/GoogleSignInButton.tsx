import React, { useEffect, useRef, useState } from 'react';
import { renderGoogleSignInButton } from '../lib/firebase';

function signInFailureMessage(reason: unknown) {
  const code = typeof reason === 'object' && reason && 'code' in reason
    ? String((reason as { code?: unknown }).code || '')
    : '';

  return code
    ? `Google accepted your account, but Spararama could not complete sign-in (${code}). Try again.`
    : 'Google accepted your account, but Spararama could not complete sign-in. Try again.';
}

export function GoogleSignInButton() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    void renderGoogleSignInButton(containerRef.current, reason => {
      setError(signInFailureMessage(reason));
    }).catch(reason => {
      console.error('Unable to render Google sign-in', reason);
      setError('Sign-in is unavailable on this device. Reload and try again.');
    });
  }, []);

  return <div className="space-y-2">
    <div ref={containerRef} className="min-h-11 flex items-center" />
    {error && <p role="alert" className="max-w-md text-sm font-black text-red-700">{error}</p>}
  </div>;
}
