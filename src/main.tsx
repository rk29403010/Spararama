import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {registerPwaServiceWorker} from './pwa';
import {PwaUpdatePrompt} from './components/PwaUpdatePrompt';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <PwaUpdatePrompt />
  </StrictMode>,
);

registerPwaServiceWorker();
