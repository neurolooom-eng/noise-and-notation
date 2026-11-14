import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase, friendlyError } from '../supabase';
import FeedbackTab from './FeedbackTab';
import DesignTab from './DesignTab';
import DataTable, { type Column } from '../ui/DataTable';
import { useSavedViews } from '../ui/useSavedViews';
import { FilterBar, Field, FormActions } from '../ui/Form';

type Tab = 'feedback' | 'summary' | 'sessions' | 'courses' | 'questions' | 'settings' | 'design';

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
  const [tab, setTab] = useState<Tab>('feedback');
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
    ['feedback', 'Feedback & insights'], ['summary', 'Summary'], ['sessions', 'Sessions'], ['courses', 'Courses'],
    ['questions', 'Questions'], ['settings', 'Settings'], ['design', 'Design'],
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
      <nav className="tabs" aria-label="Admin sections">
        {tabs.map(([k, l]) => (
          <button key={k} className={tab === k ? 'tab active' : 'tab'} aria-current={tab === k ? 'page' : undefined} onClick={() => setTab(k)}>{l}</button>
        ))}
      </nav>
      {error && <p className="error">{error}</p>}
      {tab === 'feedback' && <FeedbackTab />}
      {tab === 'summary' && <SummaryTab cohorts={cohorts} />}
      {tab === 'sessions' && <SessionsTab cohorts={cohorts} />}
      {tab === 'courses' && <CoursesTab cohorts={cohorts} reload={loadCohorts} />}
      {tab === 'questions' && <QuestionsTab />}
      {tab === 'settings' && <SettingsTab />}
      {tab === 'design' && <DesignTab />}
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
  const sessionViews = useSavedViews('summary-sessions');
  const cohortViews = useSavedViews('summary-cohorts');
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

  const scoreCell = (x: QuestionAvgRow | undefined) => x
    ? (x.average_visible && x.avg_rating != null ? <ScoreChip v={Number(x.avg_rating)} /> : <span className="muted small" title="Below the minimum number of answers">hidden</span>)
    : <span className="dt-empty">—</span>;
  const qColumnsFor = <R,>(rowsQ: QuestionAvgRow[], cols: QCol[], idOf: (r: R) => number, field: 'session_id' | 'cohort_id'): Column<R>[] =>
    cols.map((c) => ({
      id: `q:${c.key}`, header: `${shortDim(c.dimension)} · v${c.version}`, title: `Q${c.question_id} v${c.version}: ${c.statement}`,
      width: 128, align: 'center' as const,
      value: (r: R) => { const x = cell(rowsQ, idOf(r), field, c); return x?.average_visible && x.avg_rating != null ? Number(x.avg_rating) : null; },
      render: (r: R) => scoreCell(cell(rowsQ, idOf(r), field, c)),
    }));

  const sessionColumns: Column<SessionSummaryRow>[] = [
    { id: 'course', header: 'Course', width: 180, value: (r) => r.course_name },
    { id: 'cohort', header: 'Cohort', width: 110, value: (r) => r.cohort },
    { id: 'no', header: '#', width: 64, align: 'right', value: (r) => r.session_number },
    { id: 'session', header: 'Session', width: 200, value: (r) => r.title },
    { id: 'open', header: 'Feedback', width: 104, value: (r) => (r.feedback_open ? 'Open' : 'Closed') },
    { id: 'n', header: 'Responses', width: 110, align: 'right', value: (r) => r.response_count },
    ...qColumnsFor<SessionSummaryRow>(sessionQs, sessionCols, (r) => r.session_id, 'session_id'),
    {
      id: 'overall', header: 'Overall', width: 104, align: 'center',
      value: (r) => (r.averages_visible && r.overall_avg != null ? Number(r.overall_avg) : null),
      render: (r) => r.response_count > 0 && !r.averages_visible ? <span className="muted small">hidden</span> : r.overall_avg != null ? <ScoreChip v={Number(r.overall_avg)} strong /> : <span className="dt-empty">—</span>,
    },
  ];
  const cohortColumns: Column<CohortSummaryRow>[] = [
    { id: 'course', header: 'Course', width: 180, value: (r) => r.course_name },
    { id: 'cohort', header: 'Cohort', width: 110, value: (r) => r.cohort },
    { id: 'sessions', header: 'Sessions', width: 100, align: 'right', value: (r) => r.sessions_with_feedback },
    { id: 'n', header: 'Responses', width: 110, align: 'right', value: (r) => r.response_count },
    ...qColumnsFor<CohortSummaryRow>(cohortQs, cohortCols, (r) => r.cohort_id, 'cohort_id'),
    {
      id: 'overall', header: 'Overall', width: 104, align: 'center',
      value: (r) => (r.averages_visible && r.overall_avg != null ? Number(r.overall_avg) : null),
      render: (r) => !r.averages_visible ? <span className="muted small">hidden</span> : r.overall_avg != null ? <ScoreChip v={Number(r.overall_avg)} strong /> : <span className="dt-empty">—</span>,
    },
  ];

  return (
    <section>
      <FilterBar label="Summary filters">
        <Field label="Course / cohort" inline>
          <select value={cohortId} onChange={(e) => setCohortId(e.target.value === 'all' ? 'all' : Number(e.target.value))}>
            <option value="all">All courses / cohorts</option>
            {cohorts.map((c) => <option key={c.id} value={c.id}>{c.course_name} — {c.cohort}</option>)}
          </select>
        </Field>
      </FilterBar>
      {error && <p className="error">{error}</p>}
      <p className="muted small">
        Averages appear once there are at least {minN} answers (change in Settings). Each question version has its own
        column, so results are only compared on identical wording. Hover a column heading for the exact statement.
        Comments are in the Feedback &amp; insights tab.
      </p>
      <h2>Per session</h2>
      <DataTable tableKey="summary-sessions" caption="Summary per session" columns={sessionColumns} rows={sessions}
        rowKey={(r) => r.session_id} exportName="summary-by-session" emptyText="No sessions yet." viewStore={sessionViews} />
      <h2>Across courses / cohorts</h2>
      <DataTable tableKey="summary-cohorts" caption="Summary per cohort" columns={cohortColumns} rows={cohortRows}
        rowKey={(r) => r.cohort_id} exportName="summary-by-cohort" emptyText="No responses yet." viewStore={cohortViews} />
    </section>
  );
}

function shortDim(d: string) {
  return d.length > 14 ? d.split(/[\s(]/)[0] : d;
}

function ScoreChip({ v, strong }: { v: number; strong?: boolean }) {
  const cls = v >= 4.2 ? 'good' : v >= 3.5 ? 'ok' : 'low';
  const word = cls === 'good' ? 'high' : cls === 'ok' ? 'medium' : 'low';
  return <span className={`score-chip ${cls}`} title={`${v.toFixed(2)} (${word})`}>{strong ? <strong>{v.toFixed(2)}</strong> : v.toFixed(2)}</span>;
}

/* ----------------------------- Sessions ----------------------------- */

function SessionsTab({ cohorts }: { cohorts: CohortRow[] }) {
  const [cohortId, setCohortId] = useState<number | null>(null);
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [draft, setDraft] = useState({ session_number: '', title: '', session_date: '', topic: '', materials_url: '', open: true });
  const views = useSavedViews('sessions');

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

  const flash = (m: string) => { setNotice(m); window.setTimeout(() => setNotice(null), 3500); };

  async function patch(id: number, values: Partial<SessionRow>) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...values } : r)));
    const { error } = await supabase.from('sessions').update(values).eq('id', id);
    if (error) { setError(friendlyError(error)); load(); return; }
    if ('feedback_open' in values) {
      const r = rows.find((x) => x.id === id);
      flash(values.feedback_open
        ? `Session ${r?.session_number} is now OPEN — participants in this course can give feedback.`
        : `Session ${r?.session_number} is now CLOSED — participants can no longer see it.`);
    }
  }

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (cohortId == null || !draft.title.trim()) return setError('Enter a title for the session.');
    const { error } = await supabase.from('sessions').insert({
      cohort_id: cohortId,
      session_number: Number(draft.session_number),
      title: draft.title.trim(),
      session_date: draft.session_date || null,
      topic: draft.topic.trim() || null,
      materials_url: draft.materials_url.trim() || null,
      feedback_open: draft.open,
    });
    if (error) return setError(friendlyError(error));
    setError(null);
    flash(draft.open
      ? `Added session ${draft.session_number}. It is OPEN — participants can give feedback now.`
      : `Added session ${draft.session_number}. It is CLOSED — switch it to Open when it's time for feedback.`);
    setDraft({ session_number: '', title: '', session_date: '', topic: '', materials_url: '', open: true });
    load();
  }

  const cohort = cohorts.find((c) => c.id === cohortId);
  const closed = rows.filter((r) => !r.feedback_open);

  const columns: Column<SessionRow>[] = [
    { id: 'no', header: '#', width: 64, align: 'right', value: (r) => r.session_number },
    { id: 'title', header: 'Title', width: 220, value: (r) => r.title,
      render: (r) => <EditCell label={`Title for session ${r.session_number}`} value={r.title} onSave={(v) => v && patch(r.id, { title: v })} /> },
    { id: 'date', header: 'Date', width: 160, value: (r) => r.session_date,
      render: (r) => <input type="date" aria-label={`Date for session ${r.session_number}`} defaultValue={r.session_date ?? ''}
        onBlur={(e) => e.target.value !== (r.session_date ?? '') && patch(r.id, { session_date: e.target.value || null })} /> },
    { id: 'topic', header: 'Topic (shown to participants)', width: 280, value: (r) => r.topic,
      render: (r) => <EditCell multiline label={`Topic for session ${r.session_number}`} value={r.topic ?? ''} onSave={(v) => patch(r.id, { topic: v || null })} /> },
    { id: 'materials', header: 'Materials link', width: 220, value: (r) => r.materials_url,
      render: (r) => <EditCell label={`Materials link for session ${r.session_number}`} value={r.materials_url ?? ''} onSave={(v) => patch(r.id, { materials_url: v || null })} /> },
    { id: 'open', header: 'Feedback', width: 130, value: (r) => (r.feedback_open ? 'Open' : 'Closed'),
      render: (r) => (
        <label className="switch">
          <input type="checkbox" checked={r.feedback_open} onChange={(e) => patch(r.id, { feedback_open: e.target.checked })} />
          <span>{r.feedback_open ? 'Open' : 'Closed'}</span>
        </label>
      ) },
  ];

  if (!cohorts.length) return <p className="muted">Add a course / cohort first (Courses tab).</p>;

  return (
    <section>
      <FilterBar label="Sessions filter">
        <Field label="Course / cohort" inline>
          <select value={cohortId ?? ''} onChange={(e) => setCohortId(Number(e.target.value))}>
            {cohorts.map((c) => <option key={c.id} value={c.id}>{c.course_name} — {c.cohort}{c.active ? '' : ' (inactive)'}</option>)}
          </select>
        </Field>
      </FilterBar>
      {error && <p className="error">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      {cohort && !cohort.active && (
        <p className="notice-warn">● This course is inactive. <span>Participants can't see any of its sessions until you make it active again in the Courses tab.</span></p>
      )}
      {cohort?.active && rows.length > 0 && closed.length > 0 && (
        <p className="notice-warn">
          ● {closed.length === rows.length ? 'All sessions are' : `${closed.length} of ${rows.length} sessions are`} Closed.{' '}
          <span>Participants only see sessions switched to <strong>Open</strong> — switch one on when it's time for feedback.</span>
        </p>
      )}
      <p className="muted small">Edits save when you leave a field. Feedback opens and closes only when you switch it.</p>
      <DataTable tableKey="sessions" caption="Sessions" columns={columns} rows={rows} rowKey={(r) => r.id}
        exportName={`sessions-${cohort?.course_name ?? 'course'}`} emptyText="No sessions in this course yet — add one below." viewStore={views} />

      <form className="card add-form" onSubmit={add} noValidate>
        <h3>Add session</h3>
        <div className="grid">
          <Field label="Number" required><input type="number" min={1} value={draft.session_number} onChange={(e) => setDraft({ ...draft, session_number: e.target.value })} /></Field>
          <Field label="Title" required><input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} /></Field>
          <Field label="Date"><input type="date" value={draft.session_date} onChange={(e) => setDraft({ ...draft, session_date: e.target.value })} /></Field>
          <Field label="Topic" hint="Shown to participants above the questions."><input value={draft.topic} onChange={(e) => setDraft({ ...draft, topic: e.target.value })} /></Field>
          <Field label="Materials link"><input type="url" value={draft.materials_url} onChange={(e) => setDraft({ ...draft, materials_url: e.target.value })} /></Field>
        </div>
        <label className="check-field">
          <input type="checkbox" checked={draft.open} onChange={(e) => setDraft({ ...draft, open: e.target.checked })} />
          <span><strong>Open for feedback now</strong><span className="muted small">Untick to add it closed and open it later. Participants only see open sessions.</span></span>
        </label>
        <FormActions><button className="btn primary" style={{ width: 'auto' }}>Add session</button></FormActions>
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
  const [counts, setCounts] = useState<Record<number, { open: number; total: number }>>({});
  const courseNames = useMemo(() => [...new Set(cohorts.map((c) => c.course_name))], [cohorts]);
  const views = useSavedViews('courses');

  useEffect(() => {
    supabase.from('sessions').select('cohort_id,feedback_open').then(({ data }) => {
      const m: Record<number, { open: number; total: number }> = {};
      (data as { cohort_id: number; feedback_open: boolean }[] | null)?.forEach((s) => {
        m[s.cohort_id] ??= { open: 0, total: 0 };
        m[s.cohort_id].total++;
        if (s.feedback_open) m[s.cohort_id].open++;
      });
      setCounts(m);
    });
  }, [cohorts]);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!course.trim() || !cohort.trim()) return setError('Enter a course name and a cohort.');
    const { error } = await supabase.from('cohorts').insert({ course_name: course.trim(), cohort: cohort.trim() });
    if (error) return setError(friendlyError(error));
    setCourse(''); setCohort(''); setError(null); reload();
  }
  async function patch(id: number, values: Partial<CohortRow>) {
    const { error } = await supabase.from('cohorts').update(values).eq('id', id);
    if (error) setError(friendlyError(error));
    reload();
  }

  const columns: Column<CohortRow>[] = [
    { id: 'course', header: 'Course', width: 240, value: (r) => r.course_name,
      render: (r) => <EditCell label={`Course name for ${r.course_name} ${r.cohort}`} value={r.course_name} onSave={(v) => v && patch(r.id, { course_name: v })} /> },
    { id: 'cohort', header: 'Cohort', width: 160, value: (r) => r.cohort,
      render: (r) => <EditCell label={`Cohort for ${r.course_name}`} value={r.cohort} onSave={(v) => v && patch(r.id, { cohort: v })} /> },
    { id: 'sessions', header: 'Sessions', width: 110, align: 'right', value: (r) => counts[r.id]?.total ?? 0 },
    { id: 'open', header: 'Open now', width: 110, align: 'right', value: (r) => counts[r.id]?.open ?? 0 },
    { id: 'active', header: 'Active', width: 120, value: (r) => (r.active ? 'Yes' : 'No'),
      render: (r) => (
        <label className="switch">
          <input type="checkbox" checked={r.active} onChange={(e) => patch(r.id, { active: e.target.checked })} />
          <span>{r.active ? 'Yes' : 'No'}</span>
        </label>
      ) },
  ];

  return (
    <section>
      {error && <p className="error">{error}</p>}
      <p className="muted small">Each run of a course is a separate cohort, so runs can be compared. Inactive cohorts are hidden from participants.</p>
      <DataTable tableKey="courses" caption="Courses and cohorts" columns={columns} rows={cohorts} rowKey={(r) => r.id}
        exportName="courses" emptyText="No courses yet — add one below." viewStore={views}
        rowClassName={(r) => (r.active ? '' : 'inactive-row')} />
      <form className="card add-form" onSubmit={add} noValidate>
        <h3>Add course / cohort</h3>
        <div className="grid">
          <Field label="Course name" required hint="Pick an existing name for a repeat run.">
            <input list="course-names" value={course} onChange={(e) => setCourse(e.target.value)} />
          </Field>
          <Field label="Cohort" required hint="e.g. 2026-Jan"><input value={cohort} onChange={(e) => setCohort(e.target.value)} /></Field>
        </div>
        <datalist id="course-names">{courseNames.map((n) => <option key={n} value={n} />)}</datalist>
        <FormActions><button className="btn primary" style={{ width: 'auto' }}>Add</button></FormActions>
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
  const qViews = useSavedViews('questions');

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
  const qColumns: Column<QuestionRow>[] = [
    { id: 'order', header: 'Order', width: 104, value: (q) => q.position,
      render: (q) => { const i = rows.findIndex((r) => r.id === q.id); return (
        <span className="nowrap">
          <button className="icon-btn" aria-label={`Move ${q.dimension} up`} disabled={i === 0} onClick={() => move(i, -1)}>↑</button>
          <button className="icon-btn" aria-label={`Move ${q.dimension} down`} disabled={i === rows.length - 1} onClick={() => move(i, 1)}>↓</button>
        </span>
      ); } },
    { id: 'id', header: 'ID', width: 72, value: (q) => `Q${q.id}` },
    { id: 'dimension', header: 'Dimension', width: 180, value: (q) => q.dimension,
      render: (q) => <EditCell multiline label={`Dimension for Q${q.id}`} value={q.dimension} onSave={(v) => v && patch(q, { dimension: v }, `Change dimension to "${v}"?`)} /> },
    { id: 'statement', header: 'Statement', width: 360, value: (q) => q.statement,
      render: (q) => <EditCell multiline label={`Statement for Q${q.id}`} value={q.statement} onSave={(v) => v && patch(q, { statement: v }, `Change the statement to:\n"${v}"?`)} /> },
    { id: 'scale', header: 'Scale', width: 150, value: (q) => `${q.scale_min}–${q.scale_max}`,
      render: (q) => <ScaleCell q={q} onSave={(min, max) => patch(q, { scale_min: min, scale_max: max }, `Change the scale to ${min}–${max}?`)} /> },
    { id: 'active', header: 'Active', width: 124, value: (q) => (q.active ? 'Active' : 'Inactive'),
      render: (q) => (
        <label className="switch">
          <input type="checkbox" checked={q.active}
            onChange={(e) => patch(q, { active: e.target.checked }, e.target.checked
              ? `Make "${q.dimension}" active again? It will appear on the feedback form.`
              : `Make "${q.dimension}" inactive? It will no longer appear on the feedback form.`)} />
          <span>{q.active ? 'Active' : 'Inactive'}</span>
        </label>
      ) },
    { id: 'version', header: 'Version', width: 96, value: (q) => q.version, render: (q) => <strong>v{q.version}</strong> },
    { id: 'history', header: 'History', width: 120, value: () => null,
      render: (q) => (
        <button className="link" aria-expanded={openHistory === q.id} aria-label={`${openHistory === q.id ? 'Hide' : 'Show'} history of Q${q.id}`}
          onClick={() => toggleHistory(q.id)}>{openHistory === q.id ? 'Hide history' : 'Show history'}</button>
      ) },
  ];

  return (
    <section>
      {error && <p className="error">{error}</p>}
      {notice && <p className="notice" role="status">{notice}</p>}
      <p className="muted small">
        {active} active question{active === 1 ? '' : 's'} on the feedback form. {BUMP_NOTE} Inactive questions are hidden
        from participants but kept with their answers.
      </p>
      <DataTable
        tableKey="questions"
        caption="Questions"
        columns={qColumns}
        rows={rows}
        rowKey={(q) => q.id}
        exportName="questions"
        emptyText="No questions yet."
        viewStore={qViews}
        rowClassName={(q) => (q.active ? '' : 'inactive-row')}
        expandedKey={openHistory}
        renderExpanded={(q) => (
          <div className="history-wrap">
            <h4>Version history — Q{q.id}</h4>
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
          </div>
        )}
      />

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
