import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, friendlyError } from '../supabase';

type Tab = 'summary' | 'sessions' | 'courses' | 'questions' | 'settings';

interface CohortRow { id: number; course_name: string; cohort: string; active: boolean }
interface SessionRow {
  id: number; cohort_id: number; session_number: number; title: string;
  session_date: string | null; topic: string | null; feedback_open: boolean; materials_url: string | null;
}
interface QuestionRow {
  id: number; position: number; dimension: string; statement: string;
  scale_min: number; scale_max: number; active: boolean; version: number;
}
interface SettingRow { key: string; value: string }
interface SessionSummaryRow {
  cohort_id: number; course_name: string; cohort: string; session_id: number; session_number: number;
  title: string; feedback_open: boolean; response_count: number; averages_visible: boolean; overall_avg: number | null;
}
interface CohortSummaryRow {
  cohort_id: number; course_name: string; cohort: string; sessions_with_feedback: number;
  response_count: number; averages_visible: boolean; overall_avg: number | null;
}
interface QuestionAvgRow {
  session_id?: number; cohort_id?: number; question_id: number; question_version: number;
  position: number; dimension: string; statement: string;
  answer_count: number; average_visible: boolean; avg_rating: number | null;
}
interface CommentRow { session_id: number; submitted_at: string; comment: string }

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
  const [isSuper, setIsSuper] = useState(false);
  useEffect(() => { supabase.rpc('is_super_admin').then(({ data }) => setIsSuper(!!data)); }, []);

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
        <div className="admin-actions">
          {isSuper && <a className="btn small-btn" href="#/preview">👁 View as participant</a>}
          <span className="muted small">
            {email}{isSuper && ' · Super admin'} · <button className="link" onClick={() => supabase.auth.signOut()}>Sign out</button>
          </span>
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

/** One column per question *version*: answers are only compared within the same wording. */
interface QCol { key: string; question_id: number; version: number; position: number; dimension: string; statement: string }

function useQuestionColumns(rows: QuestionAvgRow[]): QCol[] {
  return useMemo(() => {
    const map = new Map<string, QCol>();
    for (const r of rows) {
      const key = `${r.question_id}:${r.question_version}`;
      if (!map.has(key)) map.set(key, { key, question_id: r.question_id, version: r.question_version, position: r.position, dimension: r.dimension, statement: r.statement });
    }
    return [...map.values()].sort((a, b) => a.position - b.position || a.question_id - b.question_id || a.version - b.version);
  }, [rows]);
}

function SummaryTab({ cohorts }: { cohorts: CohortRow[] }) {
  const [cohortId, setCohortId] = useState<number | 'all'>('all');
  const [sessions, setSessions] = useState<SessionSummaryRow[]>([]);
  const [sessionQs, setSessionQs] = useState<QuestionAvgRow[]>([]);
  const [cohortRows, setCohortRows] = useState<CohortSummaryRow[]>([]);
  const [cohortQs, setCohortQs] = useState<QuestionAvgRow[]>([]);
  const [minN, setMinN] = useState(5);
  const [openComments, setOpenComments] = useState<number | null>(null);
  const [comments, setComments] = useState<CommentRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      let s = supabase.from('session_summary').select('*').order('course_name').order('cohort').order('session_number');
      if (cohortId !== 'all') s = s.eq('cohort_id', cohortId);
      const [ss, sq, cs, cq, st] = await Promise.all([
        s,
        supabase.from('session_question_summary').select('*'),
        supabase.from('cohort_summary').select('*').order('course_name').order('cohort'),
        supabase.from('cohort_question_summary').select('*'),
        supabase.from('settings').select('value').eq('key', 'min_responses_for_summary').maybeSingle(),
      ]);
      const err = ss.error || sq.error || cs.error || cq.error;
      if (err) return setError(friendlyError(err));
      const sessionRows = ss.data as SessionSummaryRow[];
      const ids = new Set(sessionRows.map((r) => r.session_id));
      setSessions(sessionRows);
      setSessionQs((sq.data as QuestionAvgRow[]).filter((r) => ids.has(r.session_id!)));
      setCohortRows(cs.data as CohortSummaryRow[]);
      setCohortQs(cq.data as QuestionAvgRow[]);
      if (st.data) setMinN(Number(st.data.value) || 5);
    })();
  }, [cohortId]);

  const sessionCols = useQuestionColumns(sessionQs);
  const cohortCols = useQuestionColumns(cohortQs);
  const cell = (rows: QuestionAvgRow[], id: number, field: 'session_id' | 'cohort_id', col: QCol) =>
    rows.find((r) => r[field] === id && r.question_id === col.question_id && r.question_version === col.version);

  async function toggleComments(sessionId: number) {
    if (openComments === sessionId) return setOpenComments(null);
    const { data, error } = await supabase.from('session_comments').select('*').eq('session_id', sessionId).order('submitted_at');
    if (error) return setError(friendlyError(error));
    setComments(data as CommentRow[]);
    setOpenComments(sessionId);
  }

  const header = (c: QCol) => (
    <th key={c.key} title={`${c.dimension} (v${c.version}): ${c.statement}`}>
      {shortDim(c.dimension)}<br /><span className="muted small">Q{c.question_id} · v{c.version}</span>
    </th>
  );

  function exportCsv() {
    const head = ['course', 'cohort', 'session', 'title', 'responses', ...sessionCols.map((c) => `${c.dimension} (Q${c.question_id} v${c.version})`), 'overall'];
    const lines = sessions.map((r) => [r.course_name, r.cohort, r.session_number, r.title, r.response_count,
      ...sessionCols.map((c) => cell(sessionQs, r.session_id, 'session_id', c)?.avg_rating ?? ''), r.overall_avg ?? '']);
    const csv = [head, ...lines].map((l) => l.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
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
        <button className="btn" onClick={exportCsv} disabled={!sessions.length}>Export CSV</button>
      </div>
      {error && <p className="error">{error}</p>}
      <p className="muted small">
        Averages appear once there are at least {minN} answers (change in Settings). Each question version has its own
        column, so results are only compared on identical wording. Hover a column heading to see the exact statement.
      </p>

      <h2>Per session</h2>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th>Course / cohort</th><th>#</th><th>Session</th><th>n</th>{sessionCols.map(header)}<th>Overall</th><th></th></tr>
          </thead>
          <tbody>
            {sessions.map((r) => (
              <Fragment key={r.session_id}>
                <tr>
                  <td>{r.course_name}<br /><span className="muted small">{r.cohort}</span></td>
                  <td>{r.session_number}</td>
                  <td>{r.title} {r.feedback_open && <span className="pill open">open</span>}</td>
                  <td>{r.response_count}</td>
                  {sessionCols.map((c) => {
                    const x = cell(sessionQs, r.session_id, 'session_id', c);
                    return <Score key={c.key} v={x?.avg_rating ?? null} hidden={!!x && !x.average_visible} />;
                  })}
                  <Score v={r.overall_avg} hidden={r.response_count > 0 && !r.averages_visible} strong />
                  <td>{r.response_count > 0 && <button className="link" onClick={() => toggleComments(r.session_id)}>{openComments === r.session_id ? 'Hide' : 'Comments'}</button>}</td>
                </tr>
                {openComments === r.session_id && (
                  <tr className="comments-row">
                    <td colSpan={sessionCols.length + 6}>
                      {comments.length ? <ul className="comments">{comments.map((c, i) => <li key={i}>{c.comment}</li>)}</ul>
                        : <span className="muted">No comments for this session.</span>}
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {!sessions.length && <tr><td colSpan={sessionCols.length + 6} className="muted">No sessions yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <h2>Across courses / cohorts</h2>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr><th>Course / cohort</th><th>Sessions</th><th>n</th>{cohortCols.map(header)}<th>Overall</th></tr>
          </thead>
          <tbody>
            {cohortRows.map((r) => (
              <tr key={r.cohort_id}>
                <td>{r.course_name}<br /><span className="muted small">{r.cohort}</span></td>
                <td>{r.sessions_with_feedback}</td>
                <td>{r.response_count}</td>
                {cohortCols.map((c) => {
                  const x = cell(cohortQs, r.cohort_id, 'cohort_id', c);
                  return <Score key={c.key} v={x?.avg_rating ?? null} hidden={!!x && !x.average_visible} />;
                })}
                <Score v={r.overall_avg} hidden={!r.averages_visible} strong />
              </tr>
            ))}
            {!cohortRows.length && <tr><td colSpan={cohortCols.length + 4} className="muted">No responses yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function shortDim(d: string) {
  return d.length > 14 ? d.split(/[\s(]/)[0] : d;
}

function Score({ v, hidden, strong }: { v: number | null; hidden?: boolean; strong?: boolean }) {
  if (hidden) return <td className="muted small" title="Below the minimum number of answers">hidden</td>;
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
                <td><EditCell multiline label={`Topic for session ${r.session_number}`} value={r.topic ?? ''} onSave={(v) => patch(r.id, { topic: v || null })} /></td>
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

function EditCell({ value, onSave, multiline, label }: {
  value: string; onSave: (v: string) => void; multiline?: boolean; label?: string;
}) {
  const [v, setV] = useState(value);
  useEffect(() => setV(value), [value]);
  const save = () => v.trim() !== value && onSave(v.trim());
  if (multiline) {
    // Wraps so long statements are always fully readable; grows with the text.
    const rows = Math.max(2, Math.ceil(v.length / 60));
    return <textarea className="cell-textarea" aria-label={label} rows={rows} value={v} onChange={(e) => setV(e.target.value)} onBlur={save} />;
  }
  return <input aria-label={label} value={v} onChange={(e) => setV(e.target.value)} onBlur={save} />;
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

interface VersionRow {
  question_id: number; version: number; position: number; dimension: string; statement: string;
  scale_min: number; scale_max: number; active: boolean; changed_at: string; changed_by: string | null;
}

const BUMP_NOTE =
  'Any change to a question (wording, dimension, scale, active/inactive, order) creates a new version. ' +
  'Earlier answers stay under their old version and are reported separately.';

function QuestionsTab() {
  const [rows, setRows] = useState<QuestionRow[]>([]);
  const [history, setHistory] = useState<Record<number, VersionRow[]>>({});
  const [openHistory, setOpenHistory] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState({ dimension: '', statement: '', scale_min: '1', scale_max: '5' });

  const load = useCallback(async () => {
    const { data, error } = await supabase.from('questions').select('*').order('position').order('id');
    if (error) setError(friendlyError(error)); else setRows(data as QuestionRow[]);
  }, []);
  useEffect(() => { load(); }, [load]);

  function flash(msg: string) { setNotice(msg); setTimeout(() => setNotice(null), 3500); }

  async function patch(q: QuestionRow, values: Partial<QuestionRow>, label: string) {
    if (!confirm(`${label}\n\nThis will create version ${q.version + 1} of this question.\n\n${BUMP_NOTE}`)) return load();
    setError(null);
    const { data, error } = await supabase.from('questions').update(values).eq('id', q.id).select('*').single();
    if (error) { setError(friendlyError(error)); return load(); }
    const saved = data as QuestionRow;
    setRows((rs) => rs.map((r) => (r.id === saved.id ? saved : r))); // show the new state immediately
    flash(`Saved — question ${q.id} is now version ${saved.version}.`);
    setHistory((h) => { const n = { ...h }; delete n[q.id]; return n; });
    if (openHistory === q.id) setOpenHistory(null);
  }

  async function move(index: number, dir: -1 | 1) {
    const a = rows[index], b = rows[index + dir];
    if (!a || !b) return;
    if (!confirm(`Move "${a.dimension}" ${dir < 0 ? 'up' : 'down'}?\n\nReordering changes two questions, so both get a new version.\n\n${BUMP_NOTE}`)) return;
    // swap positions (use distinct values if they happen to be equal)
    const pa = a.position, pb = b.position === a.position ? a.position + dir : b.position;
    const r1 = await supabase.from('questions').update({ position: pb }).eq('id', a.id);
    const r2 = await supabase.from('questions').update({ position: pa }).eq('id', b.id);
    const err = r1.error || r2.error;
    if (err) setError(friendlyError(err)); else flash('Order updated.');
    load();
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const min = Number(draft.scale_min), max = Number(draft.scale_max);
    if (!draft.dimension.trim() || !draft.statement.trim()) return setError('Enter a dimension and a statement.');
    if (!(min < max)) return setError('Scale minimum must be lower than the maximum.');
    const { data, error } = await supabase.from('questions')
      .insert({ dimension: draft.dimension.trim(), statement: draft.statement.trim(), scale_min: min, scale_max: max })
      .select('id').single();
    if (error) return setError(friendlyError(error));
    setDraft({ dimension: '', statement: '', scale_min: '1', scale_max: '5' });
    setError(null);
    flash(`Added question ${(data as { id: number }).id} (version 1). It is active and appears on the feedback form now.`);
    load();
  }

  async function toggleHistory(id: number) {
    if (openHistory === id) return setOpenHistory(null);
    if (!history[id]) {
      const { data, error } = await supabase.from('question_versions').select('*').eq('question_id', id).order('version', { ascending: false });
      if (error) return setError(friendlyError(error));
      setHistory((h) => ({ ...h, [id]: data as VersionRow[] }));
    }
    setOpenHistory(id);
  }

  const active = rows.filter((q) => q.active).length;

  return (
    <section>
      {error && <p className="error">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      <p className="muted small">
        {active} active question{active === 1 ? '' : 's'} on the feedback form. {BUMP_NOTE} Inactive questions are hidden
        from participants but kept with their answers.
      </p>
      <div className="table-wrap">
        <table className="data edit">
          <thead>
            <tr><th>Order</th><th>ID</th><th>Dimension</th><th>Statement</th><th>Scale</th><th>Active</th><th>Version</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((q, i) => (
              <Fragment key={q.id}>
                <tr className={q.active ? '' : 'inactive-row'}>
                  <td className="nowrap">
                    <button className="icon-btn" aria-label={`Move ${q.dimension} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
                    <button className="icon-btn" aria-label={`Move ${q.dimension} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>↓</button>
                  </td>
                  <td>Q{q.id}</td>
                  <td><EditCell multiline label={`Dimension for Q${q.id}`} value={q.dimension} onSave={(v) => v && patch(q, { dimension: v }, `Change dimension to "${v}"?`)} /></td>
                  <td className="wide-cell"><EditCell multiline label={`Statement for Q${q.id}`} value={q.statement} onSave={(v) => v && patch(q, { statement: v }, `Change the statement to:\n"${v}"?`)} /></td>
                  <td className="nowrap">
                    <ScaleCell q={q} onSave={(min, max) => patch(q, { scale_min: min, scale_max: max }, `Change the scale to ${min}–${max}?`)} />
                  </td>
                  <td>
                    <label className="switch">
                      <input type="checkbox" checked={q.active}
                        onChange={(e) => patch(q, { active: e.target.checked }, e.target.checked
                          ? `Make "${q.dimension}" active again? It will appear on the feedback form.`
                          : `Make "${q.dimension}" inactive? It will no longer appear on the feedback form.`)} />
                      <span>{q.active ? 'Active' : 'Inactive'}</span>
                    </label>
                  </td>
                  <td><strong>v{q.version}</strong></td>
                  <td><button className="link" onClick={() => toggleHistory(q.id)}>{openHistory === q.id ? 'Hide history' : 'History'}</button></td>
                </tr>
                {openHistory === q.id && (
                  <tr className="comments-row">
                    <td colSpan={8}>
                      <table className="history">
                        <thead><tr><th>Version</th><th>When</th><th>By</th><th>Dimension</th><th>Statement</th><th>Scale</th><th>Active</th><th>Order</th></tr></thead>
                        <tbody>
                          {(history[q.id] ?? []).map((h) => (
                            <tr key={h.version}>
                              <td>v{h.version}</td>
                              <td className="nowrap">{new Date(h.changed_at).toLocaleString()}</td>
                              <td>{h.changed_by ?? '—'}</td>
                              <td>{h.dimension}</td>
                              <td>{h.statement}</td>
                              <td>{h.scale_min}–{h.scale_max}</td>
                              <td>{h.active ? 'Yes' : 'No'}</td>
                              <td>{h.position}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {!rows.length && <tr><td colSpan={8} className="muted">No questions yet.</td></tr>}
          </tbody>
        </table>
      </div>

      <form className="card add-form" onSubmit={add}>
        <h3>Add a question</h3>
        <p className="muted small">New questions start at version 1, are active immediately and go to the end of the list.</p>
        <div className="grid">
          <label className="field"><span>Dimension (short label)</span>
            <input value={draft.dimension} onChange={(e) => setDraft({ ...draft, dimension: e.target.value })} placeholder="e.g. Pace" required maxLength={60} /></label>
          <label className="field"><span>Scale from</span>
            <input type="number" min={0} max={9} value={draft.scale_min} onChange={(e) => setDraft({ ...draft, scale_min: e.target.value })} required /></label>
          <label className="field"><span>Scale to</span>
            <input type="number" min={1} max={10} value={draft.scale_max} onChange={(e) => setDraft({ ...draft, scale_max: e.target.value })} required /></label>
        </div>
        <label className="field"><span>Statement (shown to participants)</span>
          <textarea rows={2} value={draft.statement} onChange={(e) => setDraft({ ...draft, statement: e.target.value })}
            placeholder="e.g. The pace of the session was right for me." required maxLength={300} /></label>
        <button className="btn primary">Add question</button>
      </form>
    </section>
  );
}

function ScaleCell({ q, onSave }: { q: QuestionRow; onSave: (min: number, max: number) => void }) {
  const [min, setMin] = useState(String(q.scale_min));
  const [max, setMax] = useState(String(q.scale_max));
  useEffect(() => { setMin(String(q.scale_min)); setMax(String(q.scale_max)); }, [q.scale_min, q.scale_max]);
  const commit = () => {
    const a = Number(min), b = Number(max);
    if (a === q.scale_min && b === q.scale_max) return;
    if (!(a < b) || a < 0 || b > 10) { setMin(String(q.scale_min)); setMax(String(q.scale_max)); return; }
    onSave(a, b);
  };
  return (
    <span className="scale-cell">
      <input aria-label="Scale from" type="number" min={0} max={9} value={min} onChange={(e) => setMin(e.target.value)} onBlur={commit} />
      –
      <input aria-label="Scale to" type="number" min={1} max={10} value={max} onChange={(e) => setMax(e.target.value)} onBlur={commit} />
    </span>
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
