import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {registerPwaServiceWorker} from './pwa';
import {PwaUpdatePrompt} from './components/PwaUpdatePrompt';
import {AccessProvider} from './lib/access';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AccessProvider>
      <App />
      <PwaUpdatePrompt />
    </AccessProvider>
  </StrictMode>,
);

registerPwaServiceWorker();
