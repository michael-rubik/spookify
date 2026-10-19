import { useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { supabase } from '../utils/supabase/supabase-client'

type AuthMode = 'sign-in' | 'sign-up'

type FormState = {
  name: string
  costume: string
  email: string
  password: string
}

const initialForm: FormState = {
  name: '',
  costume: '',
  email: '',
  password: '',
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const isValidEmail = (value: string) => EMAIL_REGEX.test(value.trim())

export const Auth = () => {
  const [mode, setMode] = useState<AuthMode>('sign-in')
  const [form, setForm] = useState<FormState>(initialForm)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const updateField =
    (field: keyof FormState) => (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value
      setForm((current) => ({ ...current, [field]: value }))
    }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setMessage('')

    const cleanedEmail = form.email.trim()

    if (!isValidEmail(cleanedEmail)) {
      setError('Please enter a valid email address.')
      return
    }

    setIsSubmitting(true)

    try {
      if (mode === 'sign-up') {
        const cleanedName = form.name.trim()
        const cleanedCostume = form.costume.trim()

        const { error: signUpError } = await supabase.auth.signUp({
          email: cleanedEmail,
          password: form.password,
          options: {
            data: {
              name: cleanedName,
              costume: cleanedCostume,
            },
          },
        })

        if (signUpError) {
          throw signUpError
        }

        setForm(initialForm)
        setMode('sign-in')
        setMessage('Account created successfully. You can sign in now.')
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email: cleanedEmail,
          password: form.password,
        })

        if (signInError) {
          throw signInError
        }

        setMessage('Signed in successfully.')
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Something went wrong.'
      const lowerMessage = message.toLowerCase()

      if (lowerMessage.includes('rate limit')) {
        setError('Too many signup attempts. Please wait a few minutes and use a valid email address you can access.')
        return
      }

      setError(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="auth-wrap">
      <h1>{mode === 'sign-up' ? 'Create account' : 'Login'}</h1>

      <form onSubmit={handleSubmit} className="auth-form">
        <div className="auth-hint">
          {mode === 'sign-up'
            ? 'Use a real email address you can access. Supabase blocks repeated signup attempts.'
            : 'Use the email and password for your existing account.'}
        </div>

        {mode === 'sign-up' && (
          <input
            type="text"
            placeholder="Name"
            value={form.name}
            onChange={updateField('name')}
            required
          />
        )}

        {mode === 'sign-up' && (
          <input
            type="text"
            placeholder="Costume"
            value={form.costume}
            onChange={updateField('costume')}
            required
          />
        )}

        <input
          type="text"
          inputMode="email"
          placeholder="Email"
          value={form.email}
          onChange={updateField('email')}
          required
        />

        <input
          type="password"
          placeholder="Password"
          value={form.password}
          onChange={updateField('password')}
          minLength={6}
          required
        />

        {error && <p role="alert" className="form-error">{error}</p>}
        {message && <p role="status" className="form-success">{message}</p>}

        {mode === 'sign-up' && (
          <div className="auth-hint" style={{ fontSize: '0.8rem' }}>
            Tip: a valid email is required for account creation, and repeated attempts may be temporarily blocked.
          </div>
        )}

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Please wait...' : mode === 'sign-up' ? 'Create account' : 'Login'}
        </button>
      </form>

      <button
        type="button"
        onClick={() => {
          setMode((current) => (current === 'sign-up' ? 'sign-in' : 'sign-up'))
          setError('')
          setMessage('')
        }}
      >
        {mode === 'sign-up' ? 'Already have an account? Sign in' : 'Need an account? Create one'}
      </button>
    </div>
  )
}