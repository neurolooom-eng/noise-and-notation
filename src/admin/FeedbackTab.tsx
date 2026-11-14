import { useEffect, useMemo, useState } from 'react';
import { supabase, friendlyError } from '../supabase';
import DataTable, { type Column } from '../ui/DataTable';
import { useSavedViews } from '../ui/useSavedViews';
import { FilterBar, Field } from '../ui/Form';
import { ChartCard, KpiRow, LikertChart, LikertLegend, LineChart, StatTile, LIKERT_LABELS, type LikertItem, type LinePoint } from '../ui/charts';

interface Answer { question_id: number; version: number; rating: number }
interface FeedbackRow {
  response_id: number; submitted_at: string; cohort_id: number; course_name: string; cohort: string;
  session_id: number; session_number: number; session_title: string; session_date: string | null;
  participant_code: string; comment: string | null; question_set_version: number; answers: Answer[];
}
interface VersionRow { question_id: number; version: number; position: number; dimension: string; statement: string; scale_min: number; scale_max: number }
interface CohortRow { id: number; course_name: string; cohort: string }
interface SessionRow { id: number; cohort_id: number; session_number: number; title: string }

interface QCol extends VersionRow { key: string }
interface QStat { col: QCol; n: number; mean: number | null; counts: [number, number, number, number, number]; agree: number; disagree: number; likert: boolean }

const RANGES: [string, string][] = [['all', 'All time'], ['7', 'Last 7 days'], ['30', 'Last 30 days'], ['90', 'Last 90 days']];
const fmt = (n: number) => n.toFixed(2);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const is5 = (c: VersionRow) => c.scale_min === 1 && c.scale_max === 5;

type Tone = 'good' | 'warning' | 'info';
interface Insight { tone: Tone; title: string; detail: string }

export default function FeedbackTab() {
  const [rows, setRows] = useState<FeedbackRow[] | null>(null);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [cohorts, setCohorts] = useState<CohortRow[]>([]);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [minN, setMinN] = useState(5);
  const [error, setError] = useState<string | null>(null);
  const [cohortId, setCohortId] = useState<string>('all');
  const [sessionId, setSessionId] = useState<string>('all');
  const [range, setRange] = useState('all');
  const viewStore = useSavedViews('feedback');

  useEffect(() => {
    (async () => {
      const [fd, qv, co, se, st] = await Promise.all([
        supabase.from('feedback_detail').select('*').order('submitted_at', { ascending: false }),
        supabase.from('question_versions').select('question_id,version,position,dimension,statement,scale_min,scale_max'),
        supabase.from('cohorts').select('id,course_name,cohort').order('course_name').order('cohort'),
        supabase.from('sessions').select('id,cohort_id,session_number,title').order('session_number'),
        supabase.from('settings').select('value').eq('key', 'min_responses_for_summary').maybeSingle(),
      ]);
      const err = fd.error || qv.error || co.error || se.error;
      if (err) return setError(friendlyError(err));
      setRows(fd.data as FeedbackRow[]);
      setVersions(qv.data as VersionRow[]);
      setCohorts(co.data as CohortRow[]);
      setSessions(se.data as SessionRow[]);
      if (st.data) setMinN(Number(st.data.value) || 5);
    })();
  }, []);

  // ---------------- filters scope everything below
  const filtered = useMemo(() => {
    if (!rows) return [];
    const since = range === 'all' ? 0 : Date.now() - Number(range) * 86400000;
    return rows.filter((r) =>
      (cohortId === 'all' || String(r.cohort_id) === cohortId) &&
      (sessionId === 'all' || String(r.session_id) === sessionId) &&
      new Date(r.submitted_at).getTime() >= since);
  }, [rows, cohortId, sessionId, range]);

  // one column per question *version* present in the filtered answers
  const qcols = useMemo<QCol[]>(() => {
    const vmap = new Map(versions.map((v) => [`${v.question_id}:${v.version}`, v]));
    const keys = new Set<string>();
    filtered.forEach((r) => r.answers.forEach((a) => keys.add(`${a.question_id}:${a.version}`)));
    return [...keys].map((k) => ({ key: k, ...vmap.get(k)! })).filter((c) => c.dimension)
      .sort((a, b) => a.position - b.position || a.question_id - b.question_id || a.version - b.version);
  }, [filtered, versions]);

  const multiVersion = useMemo(() => {
    const per = new Map<number, number>();
    qcols.forEach((c) => per.set(c.question_id, (per.get(c.question_id) ?? 0) + 1));
    return new Set([...per].filter(([, n]) => n > 1).map(([id]) => id));
  }, [qcols]);
  const colLabel = (c: QCol) => (multiVersion.has(c.question_id) ? `${c.dimension} (v${c.version})` : c.dimension);

  const stats = useMemo<QStat[]>(() => qcols.map((col) => {
    const ratings = filtered.flatMap((r) => r.answers.filter((a) => `${a.question_id}:${a.version}` === col.key).map((a) => a.rating));
    const n = ratings.length;
    const counts: [number, number, number, number, number] = [0, 0, 0, 0, 0];
    const likert = is5(col);
    if (likert) ratings.forEach((v) => { if (v >= 1 && v <= 5) counts[v - 1]++; });
    return {
      col, n, counts, likert,
      mean: n ? ratings.reduce((a, b) => a + b, 0) / n : null,
      agree: likert && n ? (counts[3] + counts[4]) / n : 0,
      disagree: likert && n ? (counts[0] + counts[1]) / n : 0,
    };
  }), [qcols, filtered]);

  const allFive = useMemo(() => {
    const keys = new Set(qcols.filter(is5).map((c) => c.key));
    return filtered.flatMap((r) => r.answers.filter((a) => keys.has(`${a.question_id}:${a.version}`)).map((a) => a.rating));
  }, [filtered, qcols]);

  // ---------------- trend: one course, its sessions in order
  const trend = useMemo<LinePoint[] | null>(() => {
    if (cohortId === 'all' || sessionId !== 'all') return null;
    const fiveKeys = new Set(qcols.filter(is5).map((c) => c.key));
    return sessions.filter((s) => String(s.cohort_id) === cohortId).map((s) => {
      const rs = filtered.filter((r) => r.session_id === s.id);
      const vals = rs.flatMap((r) => r.answers.filter((a) => fiveKeys.has(`${a.question_id}:${a.version}`)).map((a) => a.rating));
      const ok = rs.length >= minN && vals.length > 0;
      return {
        label: `#${s.session_number}`,
        detail: `Session ${s.session_number} · ${s.title} · ${rs.length} response${rs.length === 1 ? '' : 's'}${ok ? '' : ` (hidden below ${minN})`}`,
        y: ok ? vals.reduce((a, b) => a + b, 0) / vals.length : null,
      };
    });
  }, [cohortId, sessionId, sessions, filtered, qcols, minN]);

  // ---------------- insights (rule-based, only from stats above the minimum)
  const insights = useMemo<Insight[]>(() => {
    const out: Insight[] = [];
    const N = filtered.length;
    if (N < minN) {
      return [{ tone: 'info', title: 'Not enough responses yet', detail: `Insights appear once there are at least ${minN} responses in this selection (currently ${N}). This protects small groups.` }];
    }
    const shown = stats.filter((s) => s.likert && s.n >= minN && s.mean != null);
    if (shown.length >= 2) {
      const best = [...shown].sort((a, b) => b.mean! - a.mean!)[0];
      const worst = [...shown].sort((a, b) => a.mean! - b.mean!)[0];
      out.push({ tone: 'good', title: `Strongest: ${colLabel(best.col)} (${fmt(best.mean!)})`, detail: `${pct(best.agree)} agree with “${best.col.statement}”` });
      out.push({ tone: worst.mean! < 3.5 ? 'warning' : 'info', title: `Lowest: ${colLabel(worst.col)} (${fmt(worst.mean!)})`, detail: `${pct(worst.disagree)} disagree with “${worst.col.statement}”` });
    }
    shown.filter((s) => s.disagree >= 0.25).forEach((s) =>
      out.push({ tone: 'warning', title: `Needs attention: ${colLabel(s.col)}`, detail: `${pct(s.disagree)} disagree or strongly disagree (${s.counts[0] + s.counts[1]} of ${s.n}).` }));
    const great = shown.filter((s) => s.agree >= 0.8);
    if (great.length) out.push({ tone: 'good', title: `Consistently positive on ${great.length} question${great.length === 1 ? '' : 's'}`, detail: great.map((s) => `${colLabel(s.col)} ${pct(s.agree)} agree`).join(' · ') });
    if (trend) {
      const vis = trend.filter((p) => p.y != null);
      if (vis.length >= 2) {
        const a = vis[vis.length - 2], b = vis[vis.length - 1], d = b.y! - a.y!;
        out.push({
          tone: d >= 0.2 ? 'good' : d <= -0.2 ? 'warning' : 'info',
          title: d >= 0.2 ? `Improving: ${b.label} up ${fmt(d)} on ${a.label}` : d <= -0.2 ? `Dipped: ${b.label} down ${fmt(-d)} on ${a.label}` : `Steady: ${b.label} within ${fmt(Math.abs(d))} of ${a.label}`,
          detail: `Average rating ${fmt(a.y!)} → ${fmt(b.y!)} across all 1–5 questions.`,
        });
      }
    }
    // lowest session (≥ minN responses) when several sessions are in view
    const bySession = new Map<number, FeedbackRow[]>();
    filtered.forEach((r) => bySession.set(r.session_id, [...(bySession.get(r.session_id) ?? []), r]));
    const fiveKeys = new Set(qcols.filter(is5).map((c) => c.key));
    const sessMeans = [...bySession.values()].filter((rs) => rs.length >= minN).map((rs) => {
      const v = rs.flatMap((r) => r.answers.filter((a) => fiveKeys.has(`${a.question_id}:${a.version}`)).map((a) => a.rating));
      return { r: rs[0], mean: v.length ? v.reduce((a, b) => a + b, 0) / v.length : null, n: rs.length };
    }).filter((x) => x.mean != null);
    if (sessMeans.length >= 2) {
      const low = sessMeans.sort((a, b) => a.mean! - b.mean!)[0];
      out.push({ tone: low.mean! < 3.5 ? 'warning' : 'info', title: `Lowest-rated session: #${low.r.session_number} ${low.r.session_title} (${fmt(low.mean!)})`, detail: `${low.r.course_name} — ${low.r.cohort}, ${low.n} responses. Read its comments in the table below.` });
    }
    const withComment = filtered.filter((r) => r.comment).length;
    out.push({ tone: 'info', title: `${withComment} of ${N} responses (${pct(withComment / N)}) include a comment`, detail: withComment ? 'Tip: sort the table by Comment, or save a view with only Session and Comment.' : 'No written comments in this selection.' });
    if (multiVersion.size) out.push({ tone: 'info', title: 'Some questions changed during this period', detail: `${[...multiVersion].map((id) => `Q${id}`).join(', ')} ${multiVersion.size === 1 ? 'has' : 'have'} answers under more than one version; each version is reported separately.` });
    const hidden = stats.filter((s) => s.likert && s.n < minN).length;
    if (hidden) out.push({ tone: 'info', title: `${hidden} question version${hidden === 1 ? '' : 's'} hidden`, detail: `Fewer than ${minN} answers — not shown, to protect small groups.` });
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered, stats, trend, minN, qcols, multiVersion]);

  // ---------------- table columns
  const columns = useMemo<Column<FeedbackRow>[]>(() => {
    const ans = (r: FeedbackRow, c: QCol) => r.answers.find((a) => a.question_id === c.question_id && a.version === c.version)?.rating ?? null;
    const fiveKeys = new Set(qcols.filter(is5).map((c) => c.key));
    return [
      { id: 'submitted', header: 'Submitted', width: 168, value: (r) => new Date(r.submitted_at), exportWidth: 18 },
      { id: 'course', header: 'Course', width: 180, value: (r) => r.course_name },
      { id: 'cohort', header: 'Cohort', width: 110, value: (r) => r.cohort },
      { id: 'session_no', header: 'Session #', width: 104, align: 'right', value: (r) => r.session_number },
      { id: 'session', header: 'Session', width: 200, value: (r) => r.session_title },
      { id: 'code', header: 'Participant code', width: 150, value: (r) => r.participant_code, hiddenByDefault: true },
      ...qcols.map<Column<FeedbackRow>>((c) => ({
        id: `q:${c.key}`, header: colLabel(c), title: `Q${c.question_id} v${c.version} (${c.scale_min}–${c.scale_max}): ${c.statement}`,
        width: 132, align: 'center', value: (r) => ans(r, c),
        render: (r) => { const v = ans(r, c); return v == null ? <span className="dt-empty">—</span> : <span className="rating-chip" aria-label={`${v} — ${is5(c) ? LIKERT_LABELS[v - 1] : `${v} of ${c.scale_max}`}`}>{v}</span>; },
      })),
      {
        id: 'avg', header: 'Avg (1–5)', width: 108, align: 'right',
        value: (r) => { const v = r.answers.filter((a) => fiveKeys.has(`${a.question_id}:${a.version}`)).map((a) => a.rating); return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 100) / 100 : null; },
      },
      { id: 'comment', header: 'Comment', width: 320, value: (r) => r.comment, exportWidth: 60 },
      { id: 'qset', header: 'Question set version', width: 120, align: 'right', value: (r) => r.question_set_version, hiddenByDefault: true },
    ];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qcols, multiVersion]);

  if (error) return <p className="error">{error}</p>;
  if (!rows) return <p className="muted">Loading feedback…</p>;

  const N = filtered.length;
  const enough = N >= minN;
  const mean = allFive.length ? allFive.reduce((a, b) => a + b, 0) / allFive.length : null;
  const agreeAll = allFive.length ? allFive.filter((v) => v >= 4).length / allFive.length : 0;
  const comments = filtered.filter((r) => r.comment).length;
  const sessionsInView = new Set(filtered.map((r) => r.session_id)).size;
  const cohortSessions = sessions.filter((s) => cohortId === 'all' || String(s.cohort_id) === cohortId);

  const likertItems: LikertItem[] = stats.filter((s) => s.likert).map((s) => ({
    key: s.col.key, label: colLabel(s.col), title: s.col.statement, counts: s.counts, mean: s.mean,
    visible: s.n >= minN, needMore: Math.max(0, minN - s.n),
  }));

  return (
    <section className="feedback-tab">
      <FilterBar label="Feedback filters">
        <Field label="Course / cohort" inline>
          <select value={cohortId} onChange={(e) => { setCohortId(e.target.value); setSessionId('all'); }}>
            <option value="all">All courses</option>
            {cohorts.map((c) => <option key={c.id} value={c.id}>{c.course_name} — {c.cohort}</option>)}
          </select>
        </Field>
        <Field label="Session" inline>
          <select value={sessionId} onChange={(e) => setSessionId(e.target.value)} disabled={cohortId === 'all'}>
            <option value="all">{cohortId === 'all' ? 'Choose a course first' : 'All sessions'}</option>
            {cohortSessions.map((s) => <option key={s.id} value={s.id}>#{s.session_number} {s.title}</option>)}
          </select>
        </Field>
        <Field label="Period" inline>
          <select value={range} onChange={(e) => setRange(e.target.value)}>
            {RANGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          </select>
        </Field>
      </FilterBar>

      <KpiRow>
        <StatTile label="Responses" value={N.toLocaleString()} sub={`${sessionsInView} session${sessionsInView === 1 ? '' : 's'}`} />
        <StatTile label="Average rating" value={enough && mean != null ? fmt(mean) : '—'}
          sub={enough ? 'out of 5, all 1–5 questions' : `shown from ${minN} responses`} />
        <StatTile label="Agree or strongly agree" value={enough && allFive.length ? pct(agreeAll) : '—'}
          status={enough && allFive.length ? (agreeAll >= 0.8 ? { tone: 'good', text: 'Strong' } : agreeAll < 0.6 ? { tone: 'warning', text: 'Review' } : undefined) : undefined}
          sub="share of all ratings" />
        <StatTile label="Comments" value={comments.toLocaleString()} sub={N ? `${pct(comments / N)} of responses` : 'no responses'} />
      </KpiRow>

      <section className="insights" aria-labelledby="insights-h">
        <h2 id="insights-h">Insights</h2>
        <ul className="insight-list">
          {insights.map((i, k) => (
            <li key={k} className={`insight ${i.tone}`}>
              <span className="insight-tag">{i.tone === 'good' ? '▲ Strength' : i.tone === 'warning' ? '● Attention' : 'ℹ Note'}</span>
              <strong>{i.title}</strong>
              <span className="muted">{i.detail}</span>
            </li>
          ))}
        </ul>
        <p className="muted small">Generated by fixed rules from the ratings in this selection (not AI). Hidden values are never used.</p>
      </section>

      <div className="chart-grid">
        <ChartCard
          title="How each question landed"
          subtitle={`Share of answers, centred on Neutral · ${N} responses`}
          legend={<LikertLegend />}
          note={stats.some((s) => !s.likert) ? 'Questions not on a 1–5 scale appear in the table only.' : undefined}
          table={{
            columns: ['Question', 'n', ...LIKERT_LABELS, 'Average'],
            rows: likertItems.map((it) => it.visible
              ? [it.label, it.counts.reduce((a, b) => a + b, 0), ...it.counts, it.mean != null ? fmt(it.mean) : '—']
              : [it.label, it.counts.reduce((a, b) => a + b, 0), 'hidden', 'hidden', 'hidden', 'hidden', 'hidden', 'hidden']),
          }}>
          {likertItems.length ? <LikertChart items={likertItems} /> : <p className="muted">No ratings in this selection.</p>}
        </ChartCard>

        <ChartCard
          title="Average rating by session"
          subtitle={trend ? `${cohorts.find((c) => String(c.id) === cohortId)?.course_name} — all 1–5 questions` : 'Pick one course (and all sessions) to see its trend'}
          table={{ columns: ['Session', 'Average', 'Detail'], rows: (trend ?? []).map((p) => [p.label, p.y == null ? 'hidden' : fmt(p.y), p.detail]) }}
          note={trend ? `Gaps = sessions with fewer than ${minN} responses (hidden).` : undefined}>
          {trend && trend.length ? <LineChart points={trend} /> : <p className="muted chart-empty">{trend ? 'No sessions in this course yet.' : 'Choose a course in the filter above.'}</p>}
        </ChartCard>
      </div>

      <h2>All feedback</h2>
      <p className="muted small">
        One row per response. No names or contacts are shown; the participant code is hidden by default.
        Drag a header to move it, drag its right edge to resize, click it to sort.
      </p>
      <DataTable
        tableKey="feedback"
        caption="All feedback responses"
        columns={columns}
        rows={filtered}
        rowKey={(r) => r.response_id}
        exportName="feedback"
        emptyText="No feedback matches these filters."
        viewStore={viewStore}
      />
    </section>
  );
}
