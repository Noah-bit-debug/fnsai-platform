import React from 'react';
import ReactDOM from 'react-dom/client';
import { ClerkProvider, useAuth } from '@clerk/clerk-react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import './styles/globals.css';
import { setTokenGetter } from './lib/api';
import { installErrorReporting } from './lib/errorReporting';
import { ToastProvider } from './components/ToastHost';
import { ConfirmProvider } from './components/ConfirmHost';

// One-shot — attaches window.onerror + unhandledrejection listeners that
// POST client-side errors to /api/v1/error-log/client for admin triage.
installErrorReporting();

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY as string;

if (!PUBLISHABLE_KEY) {
  console.warn('Missing VITE_CLERK_PUBLISHABLE_KEY. Auth will not work.');
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 2, // 2 minutes
      retry: 1,
    },
  },
});

// Inner component that has access to Clerk auth context
function AppWithAuth() {
  const { getToken } = useAuth();

  // Wire up the token getter for our axios instance
  React.useEffect(() => {
    setTokenGetter(() => getToken());
  }, [getToken]);

  return <App />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ClerkProvider publishableKey={PUBLISHABLE_KEY ?? 'pk_test_placeholder'}>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <ToastProvider>
            <ConfirmProvider>
              <AppWithAuth />
            </ConfirmProvider>
          </ToastProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ClerkProvider>
  </React.StrictMode>
);
