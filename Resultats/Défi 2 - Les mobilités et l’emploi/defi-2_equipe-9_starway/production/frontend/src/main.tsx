import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/jost/wght.css';
import './styles.css';
import { App } from './App';
import { AppErrorBoundary } from './components/AppErrorBoundary';
import { installBundleUpdateGuard } from './state/bundleUpdate';

// Site mis à jour sous une page ancienne : les échecs de chargement de modules mènent à un message, pas à une page blanche
installBundleUpdateGuard();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppErrorBoundary>
      <App />
    </AppErrorBoundary>
  </StrictMode>,
);
