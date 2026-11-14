import { useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, friendlyError, type AppConfig, type OpenSession } from '../supabase';
import FeedbackFlow from '../participant/FeedbackFlow';
import type { FlowApi } from '../participant/api';

type Persona = 'new' | 'returning';

interface CohortRow { id: number; course_name: string; cohort: string; active: boolean }
interface SessionRow {
  id: number; session_number: number; title: string; session_date: string | null;
  topic: string | null; materials_url: string | null; feedback_open: boolean;
}

/**
 * "View as participant": the real participant screens, driven by an API that
 * reads live courses/sessions/questions but never writes. Super admins only.
 */
export default function Preview() {
  const [authSession, setAuthSession] = useState<Session | null | undefined>(undefined);
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [persona, setPersona] = useState<Persona>('new');
  const [runKey, setRunKey] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setAuthSession(data.session));
  }, []);

  useEffect(() => {
    if (!authSession) return;
    supabase.rpc('is_super_admin').then(({ data }) => setAllowed(!!data));
  }, [authSession]);

  useEffect(() => {
    if (!allowed) return;
    (async () => {
      const [cfg, cohorts] = await Promise.all([
        supabase.rpc('get_app_config'),
        supabase.from('cohorts').select('id,course_name,cohort,active').order('course_name').order('cohort'),
      ]);
      const err = cfg.error || cohorts.error;
      if (err) return setError(friendlyError(err));
      const base = cfg.data as AppConfig;
      // Preview lists every cohort, including inactive ones, so you can check them before opening.
      const all = (cohorts.data as CohortRow[]).map((c) => ({
        id: c.id,
        course_name: c.course_name,
        cohort: c.active ? c.cohort : `${c.cohort} (inactive)`,
      }));
      setConfig({ ...base, cohorts: all });
    })();
  }, [allowed]);

  const api = useMemo<FlowApi>(
    () => ({
      preview: true,
      checkParticipant: async () => ({
        valid: true,
        registered: persona === 'returning',
        cohort_id: config?.cohorts[0]?.id ?? null,
      }),
      register: async () => {
        /* preview: nothing is saved */
      },
      listSessions: async (_contact, cohortId) => {
        const { data, error } = await supabase
          .from('sessions')
          .select('id,session_number,title,session_date,topic,materials_url,feedback_open')
          .eq('cohort_id', cohortId)
          .order('session_number');
        if (error) throw new Error(friendlyError(error));
        return (data as SessionRow[]).map<OpenSession>((r) => ({ ...r, already_submitted: false }));
      },
      submit: async () => {
        /* preview: nothing is saved */
      },
    }),
    [persona, config],
  );

  if (authSession === undefined || (authSession && allowed === null)) {
    return <main className="container"><p className="muted">Loading preview…</p></main>;
  }
  if (!authSession || !allowed) {
    return (
      <main className="container">
        <div className="card">
          <h2>Preview is for super admins</h2>
          <p>Sign in as a super admin to view the app as a participant.</p>
          <a className="btn" href="#/admin">Go to admin sign-in</a>
        </div>
      </main>
    );
  }

  return (
    <>
      <div className="preview-banner" role="status">
        <div className="preview-inner">
          <strong>PREVIEW — viewing as a participant.</strong> <span>Nothing you enter is saved.</span>
          <div className="preview-controls">
            <label>
              <span>Simulate</span>
              <select
                value={persona}
                onChange={(e) => {
                  setPersona(e.target.value as Persona);
                  setRunKey((k) => k + 1); // restart the flow with the new persona
                }}
              >
                <option value="new">New participant (shows registration)</option>
                <option value="returning">Returning participant (skips registration)</option>
              </select>
            </label>
            <button type="button" className="btn small-btn" onClick={() => setRunKey((k) => k + 1)}>Restart</button>
            <a className="btn small-btn" href="#/admin">Exit preview</a>
          </div>
        </div>
      </div>
      {error && <main className="container"><p className="error">{error}</p></main>}
      {config && <FeedbackFlow key={`${persona}-${runKey}`} config={config} api={api} />}
    </>
  );
}
