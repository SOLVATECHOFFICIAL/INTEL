import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import { ErrorBoundary } from './components/ErrorBoundary.tsx';
import { getCanonicalProductionOrigin } from './config/site';
import { FirebaseProvider } from './context/FirebaseProvider.tsx';
import { registerPwaServiceWorker } from './services/pwaRegistration.ts';
import { destinationFromParsedLocation } from './utils/navigationHistory';
import { applyDocumentSeoMetadata, resolvePageSeoMetadata } from './utils/seo';
import { parseLocationSearch } from './utils/urlRouting';
import './index.css';

if (typeof window !== 'undefined') {
  const initialDest = destinationFromParsedLocation(
    parseLocationSearch(window.location.search)
  );
  applyDocumentSeoMetadata(
    resolvePageSeoMetadata(initialDest, getCanonicalProductionOrigin())
  );
}

registerPwaServiceWorker();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <FirebaseProvider>
        <App />
      </FirebaseProvider>
    </ErrorBoundary>
  </StrictMode>
);
