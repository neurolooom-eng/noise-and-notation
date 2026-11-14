import { useState } from 'react';
import DataTable, { type Column } from '../ui/DataTable';
import { Field, FilterBar, FormActions } from '../ui/Form';
import { ChartCard, KpiRow, LikertChart, LikertLegend, LineChart, StatTile, type LikertItem } from '../ui/charts';

/** Living style guide: the default table, form and chart components with sample data. */

interface Sample { id: number; name: string; course: string; rating: number; comment: string }
const SAMPLE: Sample[] = [
  { id: 1, name: 'Vectors and matrices', course: 'Foundations of Math', rating: 4.6, comment: 'The visual intuition helped a lot.' },
  { id: 2, name: 'Derivatives', course: 'Foundations of Math', rating: 3.8, comment: 'Pace was a little fast in the second half.' },
  { id: 3, name: 'Exploratory analysis', course: 'Data Science', rating: 4.2, comment: '' },
  { id: 4, name: 'Probability basics', course: 'Data Science', rating: 3.1, comment: 'More worked examples please.' },
];
const sampleCols: Column<Sample>[] = [
  { id: 'name', header: 'Session', width: 200, value: (r) => r.name },
  { id: 'course', header: 'Course', width: 180, value: (r) => r.course },
  { id: 'rating', header: 'Average', width: 110, align: 'right', value: (r) => r.rating },
  { id: 'comment', header: 'Comment', width: 300, value: (r) => r.comment || null },
];
const LIKERT: LikertItem[] = [
  { key: 'a', label: 'Clarity', title: 'The concepts were explained clearly.', counts: [0, 1, 2, 9, 8], mean: 4.2, visible: true },
  { key: 'b', label: 'Doubt clearance', title: 'My doubts were addressed.', counts: [2, 4, 5, 6, 3], mean: 3.2, visible: true },
  { key: 'c', label: 'Pace', title: 'The pace was right for me.', counts: [0, 1, 1, 0, 0], mean: null, visible: false, needMore: 3 },
];

export default function DesignTab() {
  const [email, setEmail] = useState('');
  const [touched, setTouched] = useState(false);
  const emailErr = touched && !/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email) ? 'Enter a valid email, e.g. name@example.com' : null;

  return (
    <section className="design-guide">
      <p className="muted">
        These are the defaults every screen uses. Full rules: <code>docs/design-system.md</code>. Everything here meets
        WCAG AA contrast in light and dark mode.
      </p>

      <h2>Tables</h2>
      <ul className="rules">
        <li><strong>Adjustable width</strong> — drag a header's right edge; keyboard: focus the edge, ← → (Shift = bigger steps); double-click resets.</li>
        <li><strong>Rearrange</strong> — drag a header onto another; or ↑ ↓ in <em>Columns &amp; views</em> (works on touch and keyboard).</li>
        <li><strong>Export</strong> — CSV or Excel of exactly what's shown (visible columns, order, sort). Text that looks like a formula is neutralised.</li>
        <li><strong>Choose columns &amp; save the view</strong> — tick columns, then <em>Save view</em>. Views are saved to your account.</li>
        <li><strong>Density</strong> — Comfortable (default) or Compact. Text always wraps; nothing is cut off.</li>
        <li>Click a header to sort (▲ ▼). Empty values sort last. Header row stays visible while scrolling.</li>
      </ul>
      <DataTable tableKey="design-sample" caption="Sample table" columns={sampleCols} rows={SAMPLE} rowKey={(r) => r.id} exportName="sample" />

      <h2>Forms</h2>
      <ul className="rules">
        <li>Every control has a visible label above it — never placeholder-only.</li>
        <li>Hints and errors sit under the control and are linked to it for screen readers; errors are text, not just red.</li>
        <li>Validate on blur/submit, not on every keystroke. Primary action is the orange pill; one per form.</li>
        <li>Filters: one row above the content they scope; they wrap on phones.</li>
      </ul>
      <div className="card">
        <FilterBar label="Sample filters">
          <Field label="Course" inline><select defaultValue="all"><option value="all">All courses</option><option>Data Science</option></select></Field>
          <Field label="Period" inline><select defaultValue="30"><option value="30">Last 30 days</option></select></Field>
        </FilterBar>
        <Field label="Email" hint="Used only to recognise you next time." error={emailErr} required>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} onBlur={() => setTouched(true)} />
        </Field>
        <Field label="Comment" hint="Optional.">
          <textarea rows={3} />
        </Field>
        <FormActions>
          <button type="button" className="btn">Cancel</button>
          <button type="button" className="btn primary" style={{ width: 'auto' }} onClick={() => setTouched(true)}>Save</button>
        </FormActions>
      </div>

      <h2>Charts</h2>
      <ul className="rules">
        <li>Pick the form first: headline numbers are <strong>stat tiles</strong>; agree/disagree is a <strong>diverging stacked bar</strong> centred on Neutral; change over sessions is a <strong>line</strong>.</li>
        <li>Validated palette (light &amp; dark): disagree = brand orange family, agree = blue, neutral = grey. Checked for colour-blind separation.</li>
        <li>Bars ≤ 20px with 4px rounded ends and 2px gaps; 2px lines; ringed markers. Text never uses series colours.</li>
        <li>Every chart has hover/keyboard tooltips and a <strong>Table view</strong>. Values below the minimum responses are hidden, never estimated.</li>
      </ul>
      <KpiRow>
        <StatTile label="Responses" value="128" sub="12 sessions" />
        <StatTile label="Average rating" value="4.12" sub="out of 5" />
        <StatTile label="Agree or strongly agree" value="82%" status={{ tone: 'good', text: 'Strong' }} sub="share of all ratings" />
      </KpiRow>
      <div className="chart-grid">
        <ChartCard title="How each question landed" subtitle="Sample data" legend={<LikertLegend />}
          table={{ columns: ['Question', 'SD', 'D', 'N', 'A', 'SA'], rows: LIKERT.map((l) => [l.label, ...l.counts]) }}>
          <LikertChart items={LIKERT} />
        </ChartCard>
        <ChartCard title="Average rating by session" subtitle="Sample data" note="Gap = a session below the minimum responses."
          table={{ columns: ['Session', 'Average'], rows: [['#1', '3.9'], ['#2', '4.1'], ['#3', 'hidden'], ['#4', '4.4']] }}>
          <LineChart points={[
            { label: '#1', detail: 'Session 1', y: 3.9 }, { label: '#2', detail: 'Session 2', y: 4.1 },
            { label: '#3', detail: 'Session 3 (hidden)', y: null }, { label: '#4', detail: 'Session 4', y: 4.4 },
          ]} />
        </ChartCard>
      </div>
    </section>
  );
}
