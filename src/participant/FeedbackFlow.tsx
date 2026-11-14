import { useEffect, useMemo, useState } from 'react';
import {
  supabase,
  friendlyError,
  SCALE_LABELS,
  type AppConfig,
  type OpenSession,
} from '../supabase';

type Step = 'identify' | 'register' | 'select' | 'rate' | 'thanks';

const REMEMBER_KEY = 'nn-feedback-identity';

/** Mirrors public.normalize_contact() so users get instant feedback. */
export function validateContact(raw: string): string | null {
  const c = raw.trim();
  if (c.includes('@')) {
    return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(c) ? null : 'That email address does not look right.';
  }
  const digits = c.replace(/[\s\-().]/g, '');
  return /^\+?[0-9]{7,15}$/.test(digits) ? null : 'Enter a valid mobile number (7–15 digits) or an email.';
}

function readRemembered(): { name: string; contact: string } | null {
  try {
    const v = localStorage.getItem(REMEMBER_KEY);
    return v ? JSON.parse(v) : null;
  } catch {
    return null;
  }
}

export default function FeedbackFlow({ config }: { config: AppConfig }) {
  const s = config.settings;
  const remembered = useMemo(readRemembered, []);

  const [step, setStep] = useState<Step>('identify');
  const [name, setName] = useState(remembered?.name ?? '');
  const [contact, setContact] = useState(remembered?.contact ?? '');
  const [remember, setRemember] = useState(!!remembered);
  const [cohortId, setCohortId] = useState<number | null>(null);
  const [consent, setConsent] = useState(false);
  const [sessions, setSessions] = useState<OpenSession[] | null>(null);
  const [session, setSession] = useState<OpenSession | null>(null);
  const [ratings, setRatings] = useState<Record<number, number>>({});
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.scrollTo({ top: 0 });
    setError(null);
  }, [step]);

  // Load open sessions whenever the chosen cohort changes on the select step.
  useEffect(() => {
    if (step !== 'select' || cohortId == null) return;
    let cancelled = false;
    setSessions(null);
    supabase
      .rpc('list_open_sessions', { p_contact: contact, p_cohort_id: cohortId })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) setError(friendlyError(error));
        else setSessions((data as OpenSession[]) ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [step, cohortId, contact]);

  function persistIdentity() {
    try {
      if (remember) localStorage.setItem(REMEMBER_KEY, JSON.stringify({ name: name.trim(), contact: contact.trim() }));
      else localStorage.removeItem(REMEMBER_KEY);
    } catch {
      /* storage unavailable — ignore */
    }
  }

  async function handleIdentify(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return setError('Please enter your name.');
    const cErr = validateContact(contact);
    if (cErr) return setError(cErr);
    setBusy(true);
    const { data, error } = await supabase.rpc('check_participant', { p_contact: contact });
    setBusy(false);
    if (error) return setError(friendlyError(error));
    const res = data as { valid: boolean; registered: boolean; cohort_id: number | null };
    if (!res.valid) return setError('Enter a valid mobile number or email.');
    persistIdentity();
    if (res.registered) {
      const known = config.cohorts.find((c) => c.id === res.cohort_id);
      setCohortId(known ? known.id : config.cohorts[0]?.id ?? null);
      setStep('select');
    } else {
      setCohortId(config.cohorts.length === 1 ? config.cohorts[0].id : null);
      setStep('register');
    }
  }

  async function handleRegister(e: React.FormEvent) {
    e.preventDefault();
    if (cohortId == null) return setError('Please choose your course / cohort.');
    if (!consent) return setError('Please tick the consent box to continue.');
    setBusy(true);
    const { error } = await supabase.rpc('register_participant', {
      p_name: name,
      p_contact: contact,
      p_cohort_id: cohortId,
      p_consent: consent,
    });
    setBusy(false);
    if (error) return setError(friendlyError(error));
    setStep('select');
  }

  function chooseSession(sess: OpenSession) {
    setSession(sess);
    setRatings({});
    setComment('');
    setStep('rate');
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    const missing = config.questions.filter((q) => !ratings[q.position]);
    if (missing.length) {
      setError(`Please rate every statement (${missing.length} left).`);
      document.getElementById(`q-${missing[0].position}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const arr = [1, 2, 3, 4, 5, 6].map((p) => ratings[p] ?? null);
    setBusy(true);
    const { error } = await supabase.rpc('submit_feedback', {
      p_contact: contact,
      p_session_id: session.id,
      p_ratings: arr,
      p_comment: comment,
    });
    setBusy(false);
    if (error) return setError(friendlyError(error));
    setStep('thanks');
  }

  function notMe() {
    try {
      localStorage.removeItem(REMEMBER_KEY);
    } catch {
      /* ignore */
    }
    setName('');
    setContact('');
    setRemember(false);
    setStep('identify');
  }

  const cohortLabel = (id: number | null) => {
    const c = config.cohorts.find((x) => x.id === id);
    return c ? `${c.course_name} — ${c.cohort}` : '';
  };

  const answered = Object.keys(ratings).length;
  const total = config.questions.length;

  return (
    <main className="container">
      <header className="app-header">
        <h1>{s.app_title || 'Session Feedback'}</h1>
        <p className="muted">Takes about one minute. Confidential.</p>
      </header>

      {step === 'identify' && (
        <form className="card" onSubmit={handleIdentify} noValidate>
          <PrivacyNotice why={s.privacy_why} how={s.privacy_how} />
          <label className="field">
            <span>Your name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
          </label>
          <label className="field">
            <span>Mobile number or email</span>
            <input
              value={contact}
              onChange={(e) => setContact(e.target.value)}
              autoComplete="email"
              inputMode="email"
              required
            />
            <small className="muted">{s.contact_hint}</small>
          </label>
          <label className="check">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            <span>Remember me on this device</span>
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <button className="btn primary" disabled={busy}>
            {busy ? 'Checking…' : 'Continue'}
          </button>
        </form>
      )}

      {step === 'register' && (
        <form className="card" onSubmit={handleRegister} noValidate>
          <h2>First time here? Register once</h2>
          <p className="muted">Next time, just enter the same mobile number or email.</p>
          <label className="field">
            <span>Name</span>
            <input value={name} disabled />
          </label>
          <label className="field">
            <span>Mobile number or email</span>
            <input value={contact} disabled />
          </label>
          <label className="field">
            <span>Course / cohort</span>
            <select value={cohortId ?? ''} onChange={(e) => setCohortId(e.target.value ? Number(e.target.value) : null)}>
              <option value="">Choose…</option>
              {config.cohorts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.course_name} — {c.cohort}
                </option>
              ))}
            </select>
          </label>
          <PrivacyNotice why={s.privacy_why} how={s.privacy_how} compact />
          <label className="check consent">
            <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>{s.consent_text}</span>
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="row">
            <button type="button" className="btn" onClick={() => setStep('identify')}>
              Back
            </button>
            <button className="btn primary" disabled={busy || !consent}>
              {busy ? 'Registering…' : 'Register & continue'}
            </button>
          </div>
        </form>
      )}

      {step === 'select' && (
        <section className="card">
          <p className="welcome">
            Hi <strong>{name.trim().split(/\s+/)[0]}</strong>{' '}
            <button className="link" onClick={notMe}>
              Not you?
            </button>
          </p>
          <label className="field">
            <span>Course / cohort</span>
            <select value={cohortId ?? ''} onChange={(e) => setCohortId(Number(e.target.value))}>
              {config.cohorts.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.course_name} — {c.cohort}
                </option>
              ))}
            </select>
          </label>
          <h2>Choose a session</h2>
          {error && <p className="error" role="alert">{error}</p>}
          {cohortId == null && <p className="empty">No courses are open for feedback right now.</p>}
          {cohortId != null && sessions == null && !error && <p className="muted">Loading sessions…</p>}
          {sessions && sessions.length === 0 && (
            <p className="empty">No sessions are open for feedback in {cohortLabel(cohortId)} right now.</p>
          )}
          <ul className="session-list">
            {sessions?.map((x) => (
              <li key={x.id}>
                <button className="session" disabled={x.already_submitted} onClick={() => chooseSession(x)}>
                  <span className="session-num">#{x.session_number}</span>
                  <span className="session-body">
                    <strong>{x.title}</strong>
                    {x.topic && <span className="muted">{x.topic}</span>}
                    {x.session_date && <span className="muted small">{formatDate(x.session_date)}</span>}
                  </span>
                  <span className={x.already_submitted ? 'tag done' : 'tag'}>
                    {x.already_submitted ? 'Submitted ✓' : 'Give feedback →'}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {step === 'rate' && session && (
        <form className="card" onSubmit={handleSubmit} noValidate>
          <div className="session-banner">
            <span className="muted small">
              {cohortLabel(cohortId)} · Session {session.session_number}
            </span>
            <h2>{session.title}</h2>
            {session.topic && <p className="topic">{session.topic}</p>}
          </div>
          <p className="muted small">
            Rate each statement: 1 = Strongly disagree, 5 = Strongly agree.
          </p>
          <ol className="questions">
            {config.questions.map((q) => (
              <li key={q.position} id={`q-${q.position}`} className={ratings[q.position] ? 'answered' : ''}>
                <fieldset>
                  <legend>
                    <span className="dimension">{q.dimension}</span>
                    {q.statement}
                  </legend>
                  <div className="scale" role="radiogroup">
                    {range(q.scale_min, q.scale_max).map((v) => (
                      <label key={v} className={ratings[q.position] === v ? 'pt selected' : 'pt'} title={SCALE_LABELS[v]}>
                        <input
                          type="radio"
                          name={`q${q.position}`}
                          value={v}
                          checked={ratings[q.position] === v}
                          onChange={() => setRatings((r) => ({ ...r, [q.position]: v }))}
                        />
                        <span>{v}</span>
                      </label>
                    ))}
                  </div>
                  <div className="scale-ends muted small">
                    <span>Strongly disagree</span>
                    <span>Strongly agree</span>
                  </div>
                </fieldset>
              </li>
            ))}
          </ol>
          <label className="field">
            <span>
              {s.comment_prompt} <em className="muted">(optional)</em>
            </span>
            <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={4} maxLength={2000} />
          </label>
          {error && <p className="error" role="alert">{error}</p>}
          <div className="sticky-actions">
            <div className="progress" aria-label="progress">
              <div style={{ width: `${(answered / Math.max(total, 1)) * 100}%` }} />
            </div>
            <div className="row">
              <button type="button" className="btn" onClick={() => setStep('select')}>
                Back
              </button>
              <button className="btn primary" disabled={busy}>
                {busy ? 'Submitting…' : `Submit (${answered}/${total})`}
              </button>
            </div>
          </div>
        </form>
      )}

      {step === 'thanks' && (
        <section className="card center">
          <div className="big-check">✓</div>
          <h2>Thank you!</h2>
          <p>Your feedback for <strong>{session?.title}</strong> has been recorded.</p>
          {session?.materials_url && (
            <p>
              <a href={session.materials_url} target="_blank" rel="noreferrer">
                Session materials ↗
              </a>
            </p>
          )}
          <button className="btn" onClick={() => setStep('select')}>
            Feedback for another session
          </button>
        </section>
      )}

      <p className="footer muted small">Your name and contact never appear in any report.</p>
    </main>
  );
}

function PrivacyNotice({ why, how, compact }: { why?: string; how?: string; compact?: boolean }) {
  const body = (
    <>
      <h3>Why we ask for your details</h3>
      <p>{why}</p>
      <h3>How your details and feedback are handled</h3>
      <ul>
        {(how ?? '')
          .split('\n')
          .filter(Boolean)
          .map((l, i) => (
            <li key={i}>{l}</li>
          ))}
      </ul>
    </>
  );
  if (compact) {
    return (
      <details className="privacy">
        <summary>Privacy notice</summary>
        {body}
      </details>
    );
  }
  return <div className="privacy">{body}</div>;
}

function range(a: number, b: number) {
  return Array.from({ length: b - a + 1 }, (_, i) => a + i);
}

function formatDate(d: string) {
  const dt = new Date(d + 'T00:00:00');
  return isNaN(dt.getTime()) ? d : dt.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
