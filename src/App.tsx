import { lazy, Suspense, useEffect, useState } from 'react';
import FeedbackFlow from './participant/FeedbackFlow';
import { supabase, configError, friendlyError, type AppConfig } from './supabase';
import RefreshButton, { cleanRefreshParam } from './RefreshButton';

cleanRefreshParam();

const Admin = lazy(() => import('./admin/Admin'));

function useHashRoute() {
  const [hash, setHash] = useState(window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash;
}

export default function App() {
  return (
    <>
      <div className="topbar">
        <RefreshButton />
      </div>
      <Routes />
    </>
  );
}

function Routes() {
  const hash = useHashRoute();
  if (configError) return <Message title="Not configured" text={configError} />;
  if (hash.startsWith('#/admin')) {
    return (
      <Suspense fallback={<Message text="Loading…" />}>
        <Admin />
      </Suspense>
    );
  }
  return <Participant />;
}

function Participant() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.rpc('get_app_config').then(({ data, error }) => {
      if (error) setError(friendlyError(error));
      else {
        const cfg = data as AppConfig;
        setConfig(cfg);
        if (cfg.settings?.app_title) document.title = cfg.settings.app_title;
      }
    });
  }, []);

  if (error) return <Message title="Could not load" text={error} retry />;
  if (!config) return <Message text="Loading…" />;
  return <FeedbackFlow config={config} />;
}

function Message({ title, text, retry }: { title?: string; text: string; retry?: boolean }) {
  return (
    <main className="container">
      <div className="card center">
        {title && <h2>{title}</h2>}
        <p className="muted">{text}</p>
        {retry && (
          <button className="btn" onClick={() => window.location.reload()}>
            Try again
          </button>
        )}
      </div>
    </main>
  );
}
