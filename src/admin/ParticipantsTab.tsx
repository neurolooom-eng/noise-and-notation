import { useEffect, useMemo, useState } from 'react';
import { supabase, friendlyError } from '../supabase';
import DataTable, { type Column } from '../ui/DataTable';
import { useSavedViews } from '../ui/useSavedViews';
import { FilterBar, Field } from '../ui/Form';

/**
 * Participants (super admins only — spec §5.3: only the owner maps code → person).
 * Contacts are masked until "Show contacts" is switched on; exports contain
 * exactly what is on screen, so they stay masked unless contacts are shown.
 */

interface ParticipantRow {
  id: number; code: string; name: string; contact: string; contact_type: 'email' | 'mobile';
  cohort_id: number | null; consent: boolean; registered_at: string;
}
interface CohortRow { id: number; course_name: string; cohort: string }
interface Activity { n: number; last: string | null }

export function maskContact(contact: string, type: 'email' | 'mobile'): string {
  if (type === 'email') {
    const [user, domain] = contact.split('@');
    return `${user.slice(0, 1)}${'•'.repeat(Math.max(3, user.length - 1))}@${domain ?? ''}`;
  }
  const digits = contact.replace(/\D/g, '');
  const plus = contact.startsWith('+') ? '+' : '';
  const keep = digits.slice(-4);
  return `${plus}${'•'.repeat(Math.max(3, digits.length - 4))}${keep}`;
}

export default function ParticipantsTab() {
  const [rows, setRows] = useState<ParticipantRow[] | null>(null);
  const [cohorts, setCohorts] = useState<CohortRow[]>([]);
  const [activity, setActivity] = useState<Record<string, Activity>>({});
  const [error, setError] = useState<string | null>(null);
  const [cohortId, setCohortId] = useState('all');
  const [search, setSearch] = useState('');
  const [reveal, setReveal] = useState(false);
  const views = useSavedViews('participants');

  useEffect(() => {
    (async () => {
      const [p, c, r] = await Promise.all([
        supabase.from('participants').select('id,code,name,contact,contact_type,cohort_id,consent,registered_at').order('code'),
        supabase.from('cohorts').select('id,course_name,cohort').order('course_name'),
        supabase.from('responses').select('participant_code,submitted_at'),
      ]);
      const err = p.error || c.error || r.error;
      if (err) return setError(friendlyError(err));
      setRows(p.data as ParticipantRow[]);
      setCohorts(c.data as CohortRow[]);
      const a: Record<string, Activity> = {};
      (r.data as { participant_code: string; submitted_at: string }[]).forEach((x) => {
        const cur = (a[x.participant_code] ??= { n: 0, last: null });
        cur.n++;
        if (!cur.last || x.submitted_at > cur.last) cur.last = x.submitted_at;
      });
      setActivity(a);
    })();
  }, []);

  const cohortName = (id: number | null) => {
    const c = cohorts.find((x) => x.id === id);
    return c ? `${c.course_name} — ${c.cohort}` : '—';
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (rows ?? []).filter((r) =>
      (cohortId === 'all' || String(r.cohort_id) === cohortId) &&
      (!q || r.code.toLowerCase().includes(q) || r.name.toLowerCase().includes(q) || (reveal && r.contact.toLowerCase().includes(q))));
  }, [rows, cohortId, search, reveal]);

  const columns = useMemo<Column<ParticipantRow>[]>(() => [
    { id: 'code', header: 'Code', width: 96, value: (r) => r.code },
    { id: 'name', header: 'Name', width: 200, value: (r) => r.name },
    { id: 'contact', header: reveal ? 'Contact' : 'Contact (masked)', width: 220,
      value: (r) => (reveal ? r.contact : maskContact(r.contact, r.contact_type)) },
    { id: 'type', header: 'Type', width: 96, value: (r) => (r.contact_type === 'email' ? 'Email' : 'Mobile') },
    { id: 'cohort', header: 'Course / cohort', width: 220, value: (r) => cohortName(r.cohort_id) },
    { id: 'responses', header: 'Feedback given', width: 130, align: 'right', value: (r) => activity[r.code]?.n ?? 0 },
    { id: 'last', header: 'Last feedback', width: 180, value: (r) => (activity[r.code]?.last ? new Date(activity[r.code]!.last!) : null) },
    { id: 'registered', header: 'Registered', width: 180, value: (r) => new Date(r.registered_at) },
    { id: 'consent', header: 'Consent', width: 100, value: (r) => (r.consent ? 'Yes' : 'No'), hiddenByDefault: true },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [reveal, activity, cohorts]);

  if (error) return <p className="error">{error}</p>;
  if (!rows) return <p className="muted">Loading participants…</p>;

  const withFeedback = filtered.filter((r) => (activity[r.code]?.n ?? 0) > 0).length;

  return (
    <section>
      <p className="notice-warn">
        ● Personal data. <span>Only super admins can see this list. Names and contacts never appear in reports;
        use the code to look someone up. Contacts are masked until you show them, and exports match what's on screen.</span>
      </p>
      <FilterBar label="Participant filters">
        <Field label="Course / cohort" inline>
          <select value={cohortId} onChange={(e) => setCohortId(e.target.value)}>
            <option value="all">All courses</option>
            {cohorts.map((c) => <option key={c.id} value={c.id}>{c.course_name} — {c.cohort}</option>)}
          </select>
        </Field>
        <Field label="Search" inline hint={reveal ? 'Code, name or contact' : 'Code or name'}>
          <input type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="e.g. P001 or Asha" />
        </Field>
        <label className="check-field reveal-toggle">
          <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} />
          <span><strong>Show contacts</strong><span className="muted small">Unmask emails and mobile numbers</span></span>
        </label>
      </FilterBar>
      <p className="muted small">
        {filtered.length} participant{filtered.length === 1 ? '' : 's'} · {withFeedback} {withFeedback === 1 ? 'has' : 'have'} given feedback.
        To merge someone who registered twice (mobile and email), use Settings → Merge duplicate participants.
      </p>
      <DataTable tableKey="participants" caption="Participants" columns={columns} rows={filtered} rowKey={(r) => r.id}
        exportName={reveal ? 'participants' : 'participants-masked'} emptyText="No participants match." viewStore={views} />
    </section>
  );
}
