import { supabase, friendlyError, type Answer, type OpenSession } from '../supabase';

/**
 * Everything the participant flow needs from the backend. The live app uses
 * `liveApi`; the admin "View as participant" preview passes an implementation
 * that reads data but never writes.
 */
export interface FlowApi {
  preview: boolean;
  checkParticipant(contact: string): Promise<{ valid: boolean; registered: boolean; cohort_id: number | null; disabled?: boolean }>;
  register(name: string, contact: string, cohortId: number, consent: boolean): Promise<void>;
  listSessions(contact: string, cohortId: number): Promise<OpenSession[]>;
  submit(contact: string, sessionId: number, answers: Answer[], comment: string): Promise<void>;
}

/** Throws an Error carrying a participant-friendly message. */
async function call<T>(fn: string, args: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(friendlyError(error));
  return data as T;
}

export const liveApi: FlowApi = {
  preview: false,
  checkParticipant: (contact) => call('check_participant', { p_contact: contact }),
  register: async (name, contact, cohortId, consent) => {
    await call('register_participant', { p_name: name, p_contact: contact, p_cohort_id: cohortId, p_consent: consent });
  },
  listSessions: async (contact, cohortId) =>
    (await call<OpenSession[] | null>('list_open_sessions', { p_contact: contact, p_cohort_id: cohortId })) ?? [],
  submit: async (contact, sessionId, answers, comment) => {
    await call('submit_feedback', { p_contact: contact, p_session_id: sessionId, p_answers: answers, p_comment: comment });
  },
};
