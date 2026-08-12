import React, { useEffect, useRef, useState } from 'react';
import { renderGoogleSignInButton } from '../lib/firebase';

export function GoogleSignInButton() {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;
    void renderGoogleSignInButton(containerRef.current).catch((reason) => {
      console.error('Unable to render Google sign-in', reason);
      setError(true);
    });
  }, []);

  if (error) {
    return <span className="text-xs font-semibold text-red-600">Google sign-in unavailable</span>;
  }

  return <div ref={containerRef} className="min-h-8" />;
}
