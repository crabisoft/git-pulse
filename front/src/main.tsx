import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './auth';
import { ErrorBoundary } from './ErrorBoundary';
import './i18n';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      {/* The last resort. The boundary inside the shell keeps the navigation
          standing, and this one catches what happens before there is a shell —
          the sign-in screen, the reset link, the session itself. */}
      <ErrorBoundary>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ErrorBoundary>
    </BrowserRouter>
  </React.StrictMode>,
);
