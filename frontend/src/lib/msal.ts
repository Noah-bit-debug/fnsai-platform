import {
  PublicClientApplication,
  Configuration,
  LogLevel,
  BrowserCacheLocation,
} from '@azure/msal-browser';

/**
 * MSAL (Microsoft Authentication Library) configuration for the SPA.
 *
 * Replaces Clerk. Uses the Authorization Code + PKCE flow, which is the
 * only supported flow for browser-based SPAs since the 2020 deprecation
 * of Implicit Flow for new Azure AD apps.
 *
 * Env vars (set in Vercel):
 *   VITE_AZURE_CLIENT_ID — App Registration Application (client) ID
 *   VITE_AZURE_TENANT_ID — Directory (tenant) ID, single-tenant
 *   VITE_AZURE_REDIRECT_URI — Optional; defaults to current origin
 *
 * Azure Portal setup (one-time):
 *   1. Entra ID → App registrations → New registration
 *   2. Supported account types: "Accounts in this organizational directory only"
 *   3. Redirect URI → Platform: Single-page application (SPA)
 *      Add:  http://localhost:5173
 *            https://<your-vercel-prod>.vercel.app
 *   4. API permissions → Microsoft Graph → Delegated:
 *      openid, profile, email, User.Read
 *      Then click "Grant admin consent".
 *   5. Copy Application (client) ID and Directory (tenant) ID into env.
 */

const TENANT_ID = import.meta.env.VITE_AZURE_TENANT_ID as string | undefined;
const CLIENT_ID = import.meta.env.VITE_AZURE_CLIENT_ID as string | undefined;
const REDIRECT_URI =
  (import.meta.env.VITE_AZURE_REDIRECT_URI as string | undefined) ??
  (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173');

if (!TENANT_ID || !CLIENT_ID) {
  console.warn(
    '[msal] Missing VITE_AZURE_TENANT_ID or VITE_AZURE_CLIENT_ID — auth will not work.'
  );
}

const msalConfig: Configuration = {
  auth: {
    clientId: CLIENT_ID ?? 'placeholder-client-id',
    authority: `https://login.microsoftonline.com/${TENANT_ID ?? 'common'}`,
    redirectUri: REDIRECT_URI,
    postLogoutRedirectUri: REDIRECT_URI,
    navigateToLoginRequestUrl: true,
  },
  cache: {
    // sessionStorage survives page refresh within a tab but not across
    // tabs — minimizes XSS token-theft blast radius vs localStorage.
    cacheLocation: BrowserCacheLocation.SessionStorage,
    storeAuthStateInCookie: false,
  },
  system: {
    loggerOptions: {
      loggerCallback: (level, message) => {
        if (import.meta.env.PROD) return;
        if (level === LogLevel.Error) console.error('[msal]', message);
        else if (level === LogLevel.Warning) console.warn('[msal]', message);
      },
      piiLoggingEnabled: false,
    },
  },
};

/**
 * Scopes for the initial sign-in flow.
 *
 * `openid profile email` give us the standard OIDC identity claims
 * (oid, name, email) that our backend auth middleware depends on.
 * `User.Read` is Microsoft Graph's basic profile permission — cheap to
 * include and unlocks /me lookups if we ever want them.
 *
 * Add additional Graph scopes here (e.g. `Mail.Read`,
 * `Files.ReadWrite.All`) if you wire Outlook / OneDrive features back
 * up through delegated auth.
 */
export const loginRequest = {
  scopes: ['openid', 'profile', 'email', 'User.Read'],
};

/**
 * When we need a token to send to OUR backend, we use the ID token
 * (returned alongside the access token by MSAL). The ID token's audience
 * is the SPA's own client id — which is what backend/src/middleware/auth.ts
 * validates against AZURE_CLIENT_ID.
 *
 * If later you register a separate "protected web API" App Registration and
 * want a dedicated access token for it, add its Application ID URI here:
 *   scopes: ['api://<your-api-app-id>/access_as_user']
 * and update the backend AZURE_AUDIENCE env accordingly.
 */
export const apiTokenRequest = loginRequest;

export const msalInstance = new PublicClientApplication(msalConfig);
