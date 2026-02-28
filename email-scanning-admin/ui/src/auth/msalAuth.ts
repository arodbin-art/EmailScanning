import {
  InteractionRequiredAuthError,
  type AccountInfo,
  type AuthenticationResult
} from '@azure/msal-browser';
import { loginRequest, msalInstance } from './msalConfig';

function persistToken(token: string | null | undefined) {
  if (typeof window === 'undefined') return;
  if (token && token.trim()) {
    const normalized = token.trim();
    window.localStorage.setItem('authToken', normalized);
    window.localStorage.setItem('email_scanning_admin_token', normalized);
    return;
  }
  window.localStorage.removeItem('authToken');
  window.localStorage.removeItem('email_scanning_admin_token');
}

function resolveAccount(): AccountInfo | null {
  return msalInstance.getActiveAccount() ?? msalInstance.getAllAccounts()[0] ?? null;
}

function setActiveAccountFromResult(result: AuthenticationResult | null | undefined) {
  if (result?.account) {
    msalInstance.setActiveAccount(result.account);
  }
}

export async function initializeMsal() {
  await msalInstance.initialize();
  const redirectResult = await msalInstance.handleRedirectPromise();
  setActiveAccountFromResult(redirectResult);
}

export async function ensureSignedInAccount(): Promise<AccountInfo> {
  const existing = resolveAccount();
  if (existing) return existing;
  const loginResult = await msalInstance
    .loginRedirect(loginRequest)
    .then(() => null as AuthenticationResult | null);
  if (!loginResult) {
    throw new Error('Redirecting to sign in');
  }
  setActiveAccountFromResult(loginResult);
  return loginResult.account;
}

export async function acquireApiAccessToken(): Promise<string> {
  const account = await ensureSignedInAccount();
  try {
    const token = await msalInstance.acquireTokenSilent({ ...loginRequest, account });
    setActiveAccountFromResult(token);
    persistToken(token.accessToken);
    return token.accessToken;
  } catch (error) {
    if (error instanceof InteractionRequiredAuthError) {
      const token = await msalInstance
        .acquireTokenRedirect(loginRequest)
        .then(() => null as AuthenticationResult | null);
      if (!token) {
        throw new Error('Redirecting to sign in');
      }
      setActiveAccountFromResult(token);
      persistToken(token.accessToken);
      return token.accessToken;
    }
    throw error;
  }
}

export function clearStoredAuthToken() {
  persistToken(null);
}
