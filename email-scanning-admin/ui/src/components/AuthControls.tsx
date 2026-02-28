import { useEffect, useMemo, useState } from 'react';
import { EventType, InteractionRequiredAuthError, type AccountInfo } from '@azure/msal-browser';
import { useIsAuthenticated, useMsal } from '@azure/msal-react';
import { loginRequest, msalEnabled } from '../auth/msalConfig';
import { acquireApiAccessToken, clearStoredAuthToken } from '../auth/msalAuth';

export default function AuthControls() {
  const { instance, accounts, inProgress } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const [error, setError] = useState<string | null>(null);
  const [tokenPresent, setTokenPresent] = useState(false);

  const activeAccount = useMemo<AccountInfo | null>(
    () => instance.getActiveAccount() ?? accounts[0] ?? null,
    [accounts, instance, inProgress]
  );

  const signedIn = isAuthenticated || tokenPresent || accounts.length > 0;

  useEffect(() => {
    if (!msalEnabled) return;
    if (accounts.length > 0 && !instance.getActiveAccount()) {
      instance.setActiveAccount(accounts[0]);
    }
  }, [accounts, instance]);

  useEffect(() => {
    if (!msalEnabled) return;
    const callbackId = instance.addEventCallback((event) => {
      if (
        event.eventType === EventType.LOGIN_SUCCESS ||
        event.eventType === EventType.ACQUIRE_TOKEN_SUCCESS
      ) {
        const payload = event.payload as { account?: AccountInfo };
        if (payload.account) {
          instance.setActiveAccount(payload.account);
        }
        setTokenPresent(true);
        setError(null);
      }
    });
    return () => {
      if (callbackId) {
        instance.removeEventCallback(callbackId);
      }
    };
  }, [instance]);

  useEffect(() => {
    if (!msalEnabled) return;
    if (!isAuthenticated && accounts.length === 0) return;
    acquireApiAccessToken()
      .then(() => setTokenPresent(true))
      .catch((err) => {
        if (err instanceof InteractionRequiredAuthError) {
          instance.loginRedirect(loginRequest).catch(() => {
            setError('Sign-in required');
          });
          return;
        }
        setError('Sign-in required');
      });
  }, [accounts, instance, isAuthenticated]);

  function signIn() {
    if (!msalEnabled) return;
    setError(null);
    instance.loginRedirect(loginRequest).catch(() => {
      setError('Sign-in failed');
    });
  }

  function signOut() {
    if (!msalEnabled) return;
    setTokenPresent(false);
    clearStoredAuthToken();
    const logout = instance.logoutRedirect({ account: activeAccount ?? undefined });
    logout.catch(() => undefined);
  }

  const displayName = activeAccount?.name?.trim() || activeAccount?.username?.trim() || '';

  return (
    <div className="auth-controls">
      {!msalEnabled ? <span className="auth-error">Auth disabled</span> : null}
      <div className="auth-row">
        <span className={`auth-status ${signedIn ? 'signed-in' : 'signed-out'}`}>
          {signedIn ? 'Signed in' : 'Signed out'}
        </span>
        <button className="button ghost auth-button" type="button" onClick={signedIn ? signOut : signIn}>
          {signedIn ? 'Logout' : 'Login'}
        </button>
      </div>
      <div className="auth-user">{displayName ? `User: ${displayName}` : 'User: -'}</div>
      {error ? <div className="auth-error">{error}</div> : null}
    </div>
  );
}
