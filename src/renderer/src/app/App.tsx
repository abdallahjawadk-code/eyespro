import { useState, useEffect } from 'react';
import { HashRouter } from 'react-router-dom';
import { ThemeProvider } from '../context/ThemeContext';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { AppRoutes } from './routes';
import { LicenseScreen } from '../screens/LicenseScreen';

type LicenseState = 'checking' | 'ok' | 'required' | 'trial_expired';

export function App() {
  const [licenseState, setLicenseState] = useState<LicenseState>('checking');

  useEffect(() => {
    // Skip license check in development — only enforced in production builds
    if (import.meta.env.DEV) {
      setLicenseState('ok');
      return;
    }
    window.eyespro.license.status().then((res: { ok: boolean; reason?: string }) => {
      if (res.ok) {
        setLicenseState('ok');
      } else if (res.reason === 'trial_expired') {
        setLicenseState('trial_expired');
      } else {
        setLicenseState('required');
      }
    }).catch(() => {
      // Fail closed: if the status check cannot complete, require activation
      // rather than opening the app — the licence gate must never be bypassable.
      setLicenseState('required');
    });
  }, []);

  if (licenseState === 'checking') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100vh', background: '#0d0d1a', color: '#9d6fff', fontSize: '1rem' }}>
        جارٍ التحقق من الترخيص...
      </div>
    );
  }

  if (licenseState === 'trial_expired') {
    return <LicenseScreen onActivated={() => setLicenseState('ok')} trialExpired={true} />;
  }

  if (licenseState === 'required') {
    return <LicenseScreen onActivated={() => setLicenseState('ok')} />;
  }

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <HashRouter>
          <div className="app-frame">
            <AppRoutes />
          </div>
        </HashRouter>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
