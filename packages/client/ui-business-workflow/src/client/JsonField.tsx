/** JSON editor shared by run inputs and advanced definition fields. */
import { useId, useRef, useEffect, useState } from 'react'
import css from './BusinessWorkflowPage.module.css'

/**
 * Preserve invalid JSON text while keeping the last valid editor value.
 * @param props - labeled value, parser, and validity registration, released on unmount.
 * @returns JSON editor and associated validation error.
 */
export function JsonField<T>({
  label,
  value,
  onChange,
  onValidity,
  parse,
}: {
  label: string
  value: T
  onChange: (value: T) => void
  onValidity: (label: string, valid: boolean) => void
  parse?: (value: unknown) => T
}) {
  const fieldId = useId()
  const [text, setText] = useState(() => JSON.stringify(value, null, 2))
  const [error, setError] = useState('')
  const prior = useRef(value)
  useEffect(() => {
    if (prior.current === value) return
    prior.current = value
    setText(JSON.stringify(value, null, 2))
    setError('')
  }, [value])
  useEffect(() => {
    onValidity(label, error === '')
    return () => { onValidity(label, true) }
  }, [label, error, onValidity])
  return (
    <div className={css.field}>
      <label htmlFor={fieldId}>{label}</label>
      <textarea
        aria-describedby={error !== '' ? `${fieldId}-error` : undefined}
        id={fieldId}
        rows={4}
        value={text}
        aria-invalid={error !== ''}
        onChange={(event) => {
          const next = event.target.value
          setText(next)
          try {
            const raw: unknown = JSON.parse(next)
            if (parse === undefined && (raw === null || typeof raw !== 'object' || Array.isArray(raw)))
              throw new Error('Expected a JSON object.')
            const parsed = parse === undefined ? (raw as T) : parse(raw)
            prior.current = parsed
            onChange(parsed)
            setError('')
          } catch (failure) {
            setError(String(failure))
          }
        }}
      />
      {error !== '' ? (
        <span id={`${fieldId}-error`} role="alert" className={css.error}>
          {error}
        </span>
      ) : null}
    </div>
  )
}
