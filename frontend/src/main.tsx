import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles/globals.css';
import './styles/mobile.css';
import { setTokenGetter } from './lib/api';
import { installErrorReporting } from './lib/errorReporting';
import { ToastProvider } from './components/ToastHost';
import { ConfirmProvider } from './components/ConfirmHost';
import { MsalProvider, msalInstance, useAuth } from './lib/auth';
import { EventType } from '@azure/msal-browser';
import { PermissionsProvider } from './contexts/PermissionsContext';

// One-shot — attaches window.onerror + unhandledrejection listeners that
// POST client-side errors to /api/v1/error-log/client for admin triage.
installErrorReporting();

// ─── MSAL initialisation ───────────────────────────────────────────────
// MSAL needs a one-time initialize() call before React renders — without
// it, acquireTokenSilent throws "not yet initialized". We also handle the
// LOGIN_SUCCESS event to set the active account, which is what React's
// useAccount() reads.
msalInstance.initialize().then(() => {
  const accounts = msalInstance.getAllAccounts();
  if (accounts.length > 0 && !msalInstance.getActiveAccount()) {
    msalInstance.setActiveAccount(accounts[0]);
  }
  msalInstance.addEventCallback((event) => {
    if (event.eventType === EventType.LOGIN_SUCCESS && event.payload) {
      const payload = event.payload as { account?: import('@azure/msal-browser').AccountInfo };
      if (payload.account) msalInstance.setActiveAccount(payload.account);
    }
  });

  bootstrap();
});

function bootstrap() {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 1000 * 60 * 2, // 2 minutes
        retry: 1,
      },
    },
  });

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <MsalProvider instance={msalInstance}>
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <ToastProvider>
              <ConfirmProvider>
                <PermissionsProvider>
                  <AppWithAuth />
                </PermissionsProvider>
              </ConfirmProvider>
            </ToastProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </MsalProvider>
    </React.StrictMode>
  );
}

// Inner component that has access to our MSAL-backed auth hook. Wires
// the token getter for our axios instance so every API call picks up
// the current Azure access token.
function AppWithAuth() {
  const { getToken } = useAuth();
  React.useEffect(() => {
    setTokenGetter(() => getToken());
  }, [getToken]);

  return <App />;
}
