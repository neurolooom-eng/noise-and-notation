import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, friendlyError } from '../supabase';

type Tab = 'summary' | 'sessions' | 'courses' | 'questions' | 'settings';

interface CohortRow { id: number; course_name: string; cohort: string; active: boolean }
interface SessionRow {
  id: number; cohort_id: number; session_number: number; title: string;
  session_date: string | null; topic: string | null; feedback_open: boolean; materials_url: string | null;
}
interface QuestionRow { position: number; dimension: string; statement: string; active: boolean; version: number }
interface SettingRow { key: string; value: string }
interface SummaryRow {
  cohort_id: number; course_name: string; cohort: string; session_id?: number; session_number?: number;
  title?: string; feedback_open?: boolean; question_set_version: number | null; response_count: number;
  sessions_with_feedback?: number; averages_visible: boolean;
  q1_avg: number | null; q2_avg: number | null; q3_avg: number | null;
  q4_avg: number | null; q5_avg: number | null; q6_avg: number | null; overall_avg: number | null;
}
interface CommentRow { session_id: number; submitted_at: string; comment: string }

const Q_KEYS = ['q1_avg', 'q2_avg', 'q3_avg', 'q4_avg', 'q5_avg', 'q6_avg'] as const;

export default function Admin() {
  const [session, setSession] = useState<Session | null>(null);
  const [isAdmin, setIsAdmin] = useState<boolean | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return setIsAdmin(null);
    supabase.rpc('is_admin').then(({ data }) => setIsAdmin(!!data));
  }, [session]);

  if (!ready) return <main className="container"><p className="muted">Loading…</p></main>;
  if (!session) return <Login />;
  if (isAdmin === null) return <main className="container"><p className="muted">Checking access…</p></main>;
  if (!isAdmin)
    return (
      <main className="container">
        <div className="card">
          <h2>Not authorised</h2>
          <p>{session.user.email} is not listed as an owner of this app.</p>
          <button className="btn" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </main>
    );
  return <Console email={session.user.email ?? ''} />;
}

function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) setError(error.message);
  }
  return (
    <main className="container">
      <form className="card" onSubmit={submit}>
        <h1>Owner sign-in</h1>
        <label className="field"><span>Email</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" required />
        </label>
        <label className="field"><span>Password</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        {error && <p className="error">{error}</p>}
        <button className="btn primary" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="muted small"><a href="#/">← Back to feedback form</a></p>
      </form>
    </main>
  );
}

function Console({ email }: { email: string }) {
  const [tab, setTab] = useState<Tab>('summary');
  const [cohorts, setCohorts] = useState<CohortRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  const loadCohorts = useCallback(async () => {
    const { data, error } = await supabase.from('cohorts').select('*').order('course_name').order('cohort');
    if (error) setError(friendlyError(error));
    else setCohorts(data as CohortRow[]);
  }, []);
  useEffect(() => { loadCohorts(); }, [loadCohorts]);

  const tabs: [Tab, string][] = [
    ['summary', 'Summary'], ['sessions', 'Sessions'], ['courses', 'Courses'],
    ['questions', 'Questions'], ['settings', 'Settings'],
  ];

  return (
    <main className="container wide">
      <header className="admin-header">
        <h1>Feedback admin</h1>
        <div className="muted small">
          {email} · <button className="link" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </header>
      <nav className="tabs">
        {tabs.map(([k, l]) => (
          <button key={k} className={tab === k ? 'tab active' : 'tab'} onClick={() => setTab(k)}>{l}</button>
        ))}
      </nav>
      {error && <p className="error">{error}</p>}
      {tab === 'summary' && <SummaryTab cohorts={cohorts} />}
      {tab === 'sessions' && <SessionsTab cohorts={cohorts} />}
      {tab === 'courses' && <CoursesTab cohorts={cohorts} reload={loadCohorts} />}
      {tab === 'questions' && <QuestionsTab />}
      {tab === 'settings' && <SettingsTab />}
    </main>
  );
}

/* ----------------------------- Summary ----------------------------- */

function SummaryTab({ cohorts }: { cohorts: CohortRow[] }) {
  const [cohortId, setCohortId] = useState<number | 'all'>('all');
  const [rows, setRows] = useState<SummaryRow[]>([]);
  const [cohortRows, setCohortRows] = useState<SummaryRow[]>([]);
  const [questions, setQuestions] = useState<QuestionRow[]>([]);
  const [minN, setMinN] = useState(5);
  const [openComments, setOpenComments] = useState<number | null>(null);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      let q = supabase.from('session_summary').select('*').order('course_name').order('cohort').order('session_number');
      if (cohortId !== 'all') q = q.eq('cohort_id', cohortId);
      const [s, c, qs, st] = await Promise.all([
        q,
        supabase.from('cohort_summary').select('*').order('course_name').order('cohort'),
        supabase.from('questions').select('*').order('position'),
        supabase.from('settings').select('value').eq('key', 'min_responses_for_summary').maybeSingle(),
      ]);
      const err = s.error || c.error || qs.error;
      if (err) return setError(friendlyError(err));
      setRows(s.data as SummaryRow[]);
      setCohortRows(c.data as SummaryRow[]);
      setQuestions(qs.data as QuestionRow[]);
      if (st.data) setMinN(Number(st.data.value) || 5);
    })();
  }, [cohortId]);

  async function toggleComments(sessionId: number) {
    if (openComments === sessionId) return setOpenComments(null);
    const { data, error } = await supabase.from('session_comments').select('*')
      .eq('session_id', sessionId).order('submitted_at');
    if (error) return setError(friendlyError(error));
    setComments(data as CommentRow[]);
    setOpenComments(sessionId);
  }

  const qHeaders = questions.map((q) => (
    <th key={q.position} title={q.statement}>Q{q.position}<br /><span className="muted small">{q.dimension.split(' ')[0]}</span></th>
  ));

  function exportCsv() {
    const header = ['course', 'cohort', 'session', 'title', 'version', 'responses', ...questions.map((q) => `Q${q.position} ${q.dimension}`), 'overall'];
    const lines = rows.map((r) => [r.course_name, r.cohort, r.session_number, r.title, r.question_set_version ?? '', r.response_count,
      ...Q_KEYS.map((k) => r[k] ?? ''), r.overall_avg ?? '']);
    const csv = [header, ...lines].map((l) => l.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = `feedback-summary-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  }

  return (
    <section>
      <div className="toolbar">
        <select value={cohortId} onChange={(e) => setCohortId(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
          <option value="all">All courses / cohorts</option>
          {cohorts.map((c) => <option key={c.id} value={c.id}>{c.course_name} — {c.cohort}</option>)}
        </select>
        <button className="btn" onClick={exportCsv} disabled={!rows.length}>Export CSV</button>
      </div>
      {error && <p className="error">{error}</p>}
      <p className="muted small">
        Averages are shown only when a session has at least {minN} responses (change in Settings). Rows are split by
        question-set version; compare only rows with the same version.
      </p>

      <h2>Per session</h2>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th>Course / cohort</th><th>#</th><th>Session</th><th>Ver</th><th>n</th>{qHeaders}<th>Overall</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <SummaryLine key={`${r.session_id}-${r.question_set_version}`} r={r}
                onComments={() => toggleComments(r.session_id!)} commentsOpen={openComments === r.session_id}
                comments={comments} />
            ))}
            {!rows.length && <tr><td colSpan={14} className="muted">No sessions yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2>Across courses / cohorts</h2>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th>Course / cohort</th><th>Ver</th><th>Sessions</th><th>n</th>{qHeaders}<th>Overall</th></tr>
          </thead>
          <tbody>
            {cohortRows.map((r) => (
              <tr key={`${r.cohort_id}-${r.question_set_version}`}>
                <td>{r.course_name}<br /><span className="muted small">{r.cohort}</span></td>
                <td>v{r.question_set_version}</td>
                <td>{r.sessions_with_feedback}</td>
                <td>{r.response_count}</td>
                {Q_KEYS.map((k) => <Score key={k} v={r[k]} hidden={!r.averages_visible} />)}
                <Score v={r.overall_avg} hidden={!r.averages_visible} strong />
              </tr>
            ))}
            {!cohortRows.length && <tr><td colSpan={11} className="muted">No responses yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SummaryLine({ r, onComments, commentsOpen, comments }: {
  r: SummaryRow; onComments: () => void; commentsOpen: boolean; comments: CommentRow[];
}) {
  return (
    <>
      <tr>
        <td>{r.course_name}<br /><span className="muted small">{r.cohort}</span></td>
        <td>{r.session_number}</td>
        <td>{r.title} {r.feedback_open && <span className="pill open">open</span>}</td>
        <td>{r.question_set_version != null ? `v${r.question_set_version}` : '—'}</td>
        <td>{r.response_count}</td>
        {Q_KEYS.map((k) => <Score key={k} v={r[k]} hidden={!r.averages_visible && r.response_count > 0} />)}
        <Score v={r.overall_avg} hidden={!r.averages_visible && r.response_count > 0} strong />
        <td>{r.response_count > 0 && <button className="link" onClick={onComments}>{commentsOpen ? 'Hide' : 'Comments'}</button>}</td>
      </tr>
      {commentsOpen && (
        <tr className="comments-row">
          <td colSpan={14}>
            {comments.length ? (
              <ul className="comments">{comments.map((c, i) => <li key={i}>{c.comment}</li>)}</ul>
            ) : <span className="muted">No comments for this session.</span>}
          </td>
        </tr>
      )}
    </>
  );
}

function Score({ v, hidden, strong }: { v: number | null; hidden?: boolean; strong?: boolean }) {
  if (hidden) return <td className="muted small" title="Below minimum responses">hidden</td>;
  if (v == null) return <td className="muted">—</td>;
  const n = Number(v);
  const cls = n >= 4.2 ? 'good' : n >= 3.5 ? 'ok' : 'low';
  return <td className={`score ${cls}`}>{strong ? <strong>{n.toFixed(2)}</strong> : n.toFixed(2)}</td>;
}

/* ----------------------------- Sessions ----------------------------- */

function SessionsTab({ cohorts }: { cohorts: CohortRow[] }) {
  const [cohortId, setCohortId] = useState<number | null>(null);
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState({ session_number: '', title: '', session_date: '', topic: '', materials_url: '' });

  useEffect(() => {
    if (cohortId == null && cohorts.length) setCohortId(cohorts[0].id);
  }, [cohorts, cohortId]);

  const load = useCallback(async () => {
    if (cohortId == null) return;
    const { data, error } = await supabase.from('sessions').select('*').eq('cohort_id', cohortId).order('session_number');
    if (error) setError(friendlyError(error));
    else { setRows(data as SessionRow[]); setError(null); }
  }, [cohortId]);
  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    const next = rows.length ? Math.max(...rows.map((r) => r.session_number)) + 1 : 1;
    setDraft((d) => ({ ...d, session_number: String(next) }));
  }, [rows]);

  async function patch(id: number, values: Partial<SessionRow>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...values } : r)));
    const { error } = await supabase.from('sessions').update(values).eq('id', id);
    if (error) { setError(friendlyError(error)); load(); }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (cohortId == null || !draft.title.trim()) return;
    const { error } = await supabase.from('sessions').insert({
      cohort_id: cohortId,
      session_number: Number(draft.session_number),
      title: draft.title.trim(),
      session_date: draft.session_date || null,
      topic: draft.topic.trim() || null,
      materials_url: draft.materials_url.trim() || null,
    });
    if (error) return setError(friendlyError(error));
    setDraft({ session_number: '', title: '', session_date: '', topic: '', materials_url: '' });
    load();
  }

  if (!cohorts.length) return <p className="muted">Add a course / cohort first (Courses tab).</p>;

  return (
    <section>
      <div className="toolbar">
        <select value={cohortId ?? ''} onChange={(e) => setCohortId(Number(e.target.value))}>
          {cohorts.map((c) => <option key={c.id} value={c.id}>{c.course_name} — {c.cohort}{c.active ? '' : ' (inactive)'}</option>)}
        </select>
      </div>
      {error && <p className="error">{error}</p>}
      <p className="muted small">Feedback opens and closes only when you toggle it. Edits save when you leave a field.</p>
      <div className="table-wrap">
        <table className="data edit">
          <thead><tr><th>#</th><th>Title</th><th>Date</th><th>Topic (shown to participants)</th><th>Materials link</th><th>Feedback</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>{r.session_number}</td>
                <td><EditCell value={r.title} onSave={(v) => v && patch(r.id, { title: v })} /></td>
                <td><input type="date" defaultValue={r.session_date ?? ''} onBlur={(e) => e.target.value !== (r.session_date ?? '') && patch(r.id, { session_date: e.target.value || null })} /></td>
                <td><EditCell value={r.topic ?? ''} onSave={(v) => patch(r.id, { topic: v || null })} /></td>
                <td><EditCell value={r.materials_url ?? ''} onSave={(v) => patch(r.id, { materials_url: v || null })} /></td>
                <td>
                  <label className="switch">
                    <input type="checkbox" checked={r.feedback_open} onChange={(e) => patch(r.id, { feedback_open: e.target.checked })} />
                    <span>{r.feedback_open ? 'Open' : 'Closed'}</span>
                  </label>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6} className="muted">No sessions in this cohort yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <form className="card add-form" onSubmit={add}>
        <h3>Add session</h3>
        <div className="grid">
          <label className="field"><span>Number</span>
            <input type="number" min={1} value={draft.session_number} onChange={(e) => setDraft({ ...draft, session_number: e.target.value })} required /></label>
          <label className="field"><span>Title</span>
            <input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} required /></label>
          <label className="field"><span>Date</span>
            <input type="date" value={draft.session_date} onChange={(e) => setDraft({ ...draft, session_date: e.target.value })} /></label>
          <label className="field"><span>Topic</span>
            <input value={draft.topic} onChange={(e) => setDraft({ ...draft, topic: e.target.value })} /></label>
          <label className="field"><span>Materials link</span>
            <input type="url" value={draft.materials_url} onChange={(e) => setDraft({ ...draft, materials_url: e.target.value })} /></label>
        </div>
        <button className="btn primary">Add session</button>
      </form>
    </section>
  );
}

function EditCell({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  return <input value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v.trim() !== value && onSave(v.trim())} />;
}

/* ----------------------------- Courses ----------------------------- */

function CoursesTab({ cohorts, reload }: { cohorts: CohortRow[]; reload: () => void }) {
  const [course, setCourse] = useState('');
  const [cohort, setCohort] = useState('');
  const [error, setError] = useState<string | null>(null);
  const courseNames = useMemo(() => [...new Set(cohorts.map((c) => c.course_name))], [cohorts]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const { error } = await supabase.from('cohorts').insert({ course_name: course.trim(), cohort: cohort.trim() });
    if (error) return setError(friendlyError(error));
    setCourse(''); setCohort(''); setError(null); reload();
  }
  async function toggle(id: number, active: boolean) {
    const { error } = await supabase.from('cohorts').update({ active }).eq('id', id);
    if (error) setError(friendlyError(error));
    reload();
  }

  return (
    <section>
      {error && <p className="error">{error}</p>}
      <p className="muted small">Each run of a course is a separate cohort, so runs can be compared. Inactive cohorts are hidden from participants.</p>
      <div className="table-wrap">
        <table className="data">
          <thead><tr><th>Course</th><th>Cohort</th><th>Active</th></tr></thead>
          <tbody>
            {cohorts.map((c) => (
              <tr key={c.id}>
                <td>{c.course_name}</td><td>{c.cohort}</td>
                <td><label className="switch"><input type="checkbox" checked={c.active} onChange={(e) => toggle(c.id, e.target.checked)} /><span>{c.active ? 'Yes' : 'No'}</span></label></td>
              </tr>
            ))}
            {!cohorts.length && <tr><td colSpan={3} className="muted">No courses yet.</td></tr>}
          </tbody>
        </table>
      </div>
      <form className="card add-form" onSubmit={add}>
        <h3>Add course / cohort</h3>
        <div className="grid">
          <label className="field"><span>Course name</span>
            <input list="course-names" value={course} onChange={(e) => setCourse(e.target.value)} required />
            <datalist id="course-names">{courseNames.map((n) => <option key={n} value={n} />)}</datalist>
          </label>
          <label className="field"><span>Cohort (e.g. 2026-Jan)</span>
            <input value={cohort} onChange={(e) => setCohort(e.target.value)} required /></label>
        </div>
        <button className="btn primary">Add</button>
      </form>
    </section>
  );
}

/* ----------------------------- Questions ----------------------------- */

function QuestionsTab() {
  const [rows, setRows] = useState<QuestionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    const { data, error } = await supabase.from('questions').select('*').order('position');
    if (error) setError(friendlyError(error)); else setRows(data as QuestionRow[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function patch(position: number, values: Partial<QuestionRow>) {
    if (!confirm('Changing a question increases the question-set version. Earlier responses stay under the old version. Continue?')) return load();
    const { error } = await supabase.from('questions').update(values).eq('position', position);
    if (error) setError(friendlyError(error));
    load();
  }

  return (
    <section>
      {error && <p className="error">{error}</p>}
      <p className="muted small">Scale: 1 = Strongly disagree … 5 = Strongly agree. Every edit bumps the version number stored with each response.</p>
      <div className="table-wrap">
        <table className="data edit">
          <thead><tr><th>#</th><th>Dimension</th><th>Statement</th><th>Active</th><th>Ver</th></tr></thead>
          <tbody>
            {rows.map((q) => (
              <tr key={q.position}>
                <td>Q{q.position}</td>
                <td><EditCell value={q.dimension} onSave={(v) => v && patch(q.position, { dimension: v })} /></td>
                <td className="wide-cell"><EditCell value={q.statement} onSave={(v) => v && patch(q.position, { statement: v })} /></td>
                <td><input type="checkbox" checked={q.active} onChange={(e) => patch(q.position, { active: e.target.checked })} /></td>
                <td>v{q.version}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ----------------------------- Settings ----------------------------- */

const SETTING_LABELS: Record<string, string> = {
  app_title: 'App title',
  min_responses_for_summary: 'Minimum responses before averages are shown',
  question_set_version: 'Question-set version (auto)',
  privacy_why: 'Privacy notice — why we ask',
  privacy_how: 'Privacy notice — how details are handled (one point per line)',
  consent_text: 'Consent tick-box text',
  contact_hint: 'Hint under the contact field',
  comment_prompt: 'Optional comment prompt',
};

function SettingsTab() {
  const [rows, setRows] = useState<SettingRow[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [keep, setKeep] = useState('');
  const [drop, setDrop] = useState('');

  useEffect(() => {
    supabase.from('settings').select('key,value').order('key').then(({ data, error }) => {
      if (error) setError(friendlyError(error)); else setRows(data as SettingRow[]);
    });
  }, []);

  async function save(key: string, value: string) {
    const { error } = await supabase.from('settings').update({ value, updated_at: new Date().toISOString() }).eq('key', key);
    if (error) return setError(friendlyError(error));
    setSaved(key); setTimeout(() => setSaved(null), 1500);
  }

  async function merge(e: React.FormEvent) {
    e.preventDefault();
    if (!confirm(`Merge ${drop} into ${keep}? ${drop} will be deleted.`)) return;
    const { data, error } = await supabase.rpc('merge_participants', { p_keep_code: keep.trim(), p_drop_code: drop.trim() });
    if (error) return setError(friendlyError(error));
    alert(`Merged. Responses moved: ${data.moved}; duplicate responses dropped: ${data.dropped_duplicates}.`);
    setKeep(''); setDrop('');
  }

  return (
    <section>
      {error && <p className="error">{error}</p>}
      <div className="card">
        {rows.map((r) => (
          <label key={r.key} className="field">
            <span>{SETTING_LABELS[r.key] ?? r.key} {saved === r.key && <em className="saved">saved ✓</em>}</span>
            {r.key === 'question_set_version' ? (
              <input value={r.value} disabled />
            ) : r.value.length > 60 || r.key.startsWith('privacy') ? (
              <textarea defaultValue={r.value} rows={r.key === 'privacy_how' ? 5 : 3} onBlur={(e) => e.target.value !== r.value && save(r.key, e.target.value)} />
            ) : (
              <input defaultValue={r.value} onBlur={(e) => e.target.value !== r.value && save(r.key, e.target.value)} />
            )}
          </label>
        ))}
      </div>
      <form className="card add-form" onSubmit={merge}>
        <h3>Merge duplicate participants</h3>
        <p className="muted small">
          If someone registered once with mobile and once with email, merge the two internal codes (look them up in the
          Supabase table editor → participants). Responses move to the kept code.
        </p>
        <div className="grid">
          <label className="field"><span>Keep code</span><input value={keep} onChange={(e) => setKeep(e.target.value)} placeholder="P001" required /></label>
          <label className="field"><span>Merge &amp; delete code</span><input value={drop} onChange={(e) => setDrop(e.target.value)} placeholder="P007" required /></label>
        </div>
        <button className="btn">Merge</button>
      </form>
    </section>
  );
}
