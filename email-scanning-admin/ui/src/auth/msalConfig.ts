import type { Configuration } from '@azure/msal-browser';
import { PublicClientApplication } from '@azure/msal-browser';

const defaultTenantId = '68c5da70-0623-45da-aee1-f64aef4a5ceb';
const defaultUiClientId = 'a3338ab1-ddb2-4c50-831d-051549e314cc';
const defaultApiClientId = 'a6167d86-539d-425d-8c6e-0d464d90ec07';

const tenantId = import.meta.env.VITE_ENTRA_TENANT_ID ?? defaultTenantId;
const clientId = import.meta.env.VITE_UI_CLIENT_ID ?? defaultUiClientId;
const apiClientId = import.meta.env.VITE_ENTRA_API_CLIENT_ID ?? defaultApiClientId;
const redirectUri =
  import.meta.env.VITE_REDIRECT_URI ??
  (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5175');

export const msalEnabled = Boolean(clientId && tenantId);

export const apiScope =
  import.meta.env.VITE_API_SCOPE ?? `api://${apiClientId}/access_as_user`;

const resolvedClientId = clientId || defaultUiClientId;

export const msalConfig: Configuration = {
  auth: {
    clientId: resolvedClientId,
    authority: `https://login.microsoftonline.com/${tenantId}/v2.0`,
    redirectUri
  },
  cache: {
    cacheLocation: 'localStorage'
  }
};

export const defaultScopes = ['openid', 'profile', 'offline_access', apiScope];
export const loginRequest = { scopes: defaultScopes };

export const msalInstance = new PublicClientApplication(msalConfig);
