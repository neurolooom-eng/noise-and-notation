import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const configError =
  !url || !key
    ? 'App is not configured: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be set at build time.'
    : null;

export const supabase = createClient(url ?? 'http://localhost', key ?? 'missing-key', {
  auth: { persistSession: true, autoRefreshToken: true },
});

/** Turn a Supabase/PostgREST error into a message fit for participants. */
export function friendlyError(err: unknown): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const e = err as { message: string; code?: string };
    // Messages raised by our own SQL functions (errcode P0001) are written for end users.
    if (e.code === 'P0001') return e.message;
    if (/fetch|network/i.test(e.message)) return 'Network problem. Please check your connection and try again.';
    return e.message;
  }
  return 'Something went wrong. Please try again.';
}

export interface Cohort {
  id: number;
  course_name: string;
  cohort: string;
}

export interface Question {
  position: number;
  dimension: string;
  statement: string;
  scale_min: number;
  scale_max: number;
}

export interface AppConfig {
  settings: Record<string, string>;
  cohorts: Cohort[];
  questions: Question[];
}

export interface OpenSession {
  id: number;
  session_number: number;
  title: string;
  session_date: string | null;
  topic: string | null;
  materials_url: string | null;
  already_submitted: boolean;
}

export const SCALE_LABELS: Record<number, string> = {
  1: 'Strongly disagree',
  2: 'Disagree',
  3: 'Neutral',
  4: 'Agree',
  5: 'Strongly agree',
};
