import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { negotiateAuthenticatedLocale } from '@a-conversa/i18n-catalogs';
import { AuthProvider, createI18nInstance, I18nProvider } from '@a-conversa/shell';
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
