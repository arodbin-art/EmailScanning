import React from 'react';
import { createRoot } from 'react-dom/client';
import { MsalProvider } from '@azure/msal-react';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { msalInstance } from './auth/msalConfig';
import { initializeMsal } from './auth/msalAuth';
import './styles.css';

const root = document.getElementById('root');

if (root) {
  initializeMsal()
    .catch((err) => {
      console.error('MSAL initialization failed', err);
    })
    .finally(() => {
      createRoot(root).render(
        <React.StrictMode>
          <MsalProvider instance={msalInstance}>
            <BrowserRouter>
              <App />
            </BrowserRouter>
          </MsalProvider>
        </React.StrictMode>
      );
    });
}
