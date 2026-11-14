import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';

/**
 * Form defaults.
 *
 *  <Field label="Email" hint="We never share it" error={err}>
 *    <input type="email" … />
 *  </Field>
 *
 * - The label is always visible (no placeholder-only labels).
 * - Hint and error are linked to the control with aria-describedby;
 *   errors set aria-invalid and are announced (role="alert").
 * - Required fields are marked in text, not colour alone.
 */
export function Field({
  label, hint, error, required, children, inline,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  required?: boolean;
  inline?: boolean;
  children: ReactElement<Record<string, unknown>>;
}) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errId = error ? `${id}-err` : undefined;
  const control = isValidElement(children)
    ? cloneElement(children, {
        id: (children.props.id as string) ?? id,
        'aria-describedby': [hintId, errId].filter(Boolean).join(' ') || undefined,
        'aria-invalid': error ? true : undefined,
        required: required || (children.props.required as boolean | undefined),
      })
    : children;
  return (
    <div className={`field ${inline ? 'field-inline' : ''} ${error ? 'has-error' : ''}`}>
      <label htmlFor={(isValidElement(children) && (children.props.id as string)) || id}>
        {label}
        {required && <span className="req"> (required)</span>}
      </label>
      {control}
      {hint && <small id={hintId} className="field-hint">{hint}</small>}
      {error && <small id={errId} className="field-error" role="alert">{error}</small>}
    </div>
  );
}

/** A row of form actions: primary action first on mobile, right-aligned on wide screens. */
export function FormActions({ children }: { children: ReactNode }) {
  return <div className="form-actions">{children}</div>;
}

/** Filter bar: one row of controls above the content they scope (wraps on phones). */
export function FilterBar({ children, label = 'Filters' }: { children: ReactNode; label?: string }) {
  return (
    <div className="filter-bar" role="group" aria-label={label}>
      {children}
    </div>
  );
}
