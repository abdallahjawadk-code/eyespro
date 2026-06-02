import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './app/App';
import './i18n';
import './styles/tokens.css';
import './styles/global.css';
import './ui/ui.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,       // 30s before re-fetching
      gcTime: 5 * 60_000,      // 5min cache retention
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

document.documentElement.setAttribute('data-theme', 'dark');
document.documentElement.style.colorScheme = 'dark';

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found');

function BootError({ message }: { message: string }) {
  return (
    <div
      style={{
        height: '100vh',
        display: 'grid',
        placeItems: 'center',
        padding: 24,
        background: '#0a0b10',
        color: '#f0f4ff',
        fontFamily: 'system-ui, sans-serif',
        textAlign: 'center'
      }}
    >
      <div>
        <h1 style={{ marginBottom: 12 }}>EyesPro</h1>
        <p style={{ color: '#8b95b5', maxWidth: 420 }}>{message}</p>
      </div>
    </div>
  );
}

if (!window.eyespro) {
  createRoot(rootEl).render(
    <BootError message="Bridge preload failed. Restart the app (npm run dev)." />
  );
} else {
  createRoot(rootEl).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>
  );
}
