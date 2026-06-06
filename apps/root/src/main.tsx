import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { negotiateAuthenticatedLocale } from '@a-conversa/i18n-catalogs';
import { AuthProvider, createI18nInstance, I18nProvider } from '@a-conversa/shell';
// Shared graph-overlay animation CSS, co-located with the overlay
// components per ADR 0039. Importing it here is what makes the landing
// page's node-appear / withdrawal / decomposition / diagnostic-fire
// halos (and the axiom-mark + pill-agreed pulses) actually render — the
// overlay <span>s were already emitted, but the keyframes/geometry only
// lived in the audience app until this extraction.
import '@a-conversa/graph-view/overlays.css';
import './index.css';
import App from './App';

async function bootstrap(): Promise<void> {
  const i18n = await createI18nInstance(negotiateAuthenticatedLocale());
  const rootElement = document.getElementById('root');

  if (rootElement === null) {
    throw new Error('Root element #root not found in index.html');
  }

  createRoot(rootElement).render(
    <StrictMode>
      <I18nProvider i18n={i18n}>
        <AuthProvider>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </AuthProvider>
      </I18nProvider>
    </StrictMode>,
  );
}

void bootstrap();
