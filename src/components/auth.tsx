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
        setMessage('Account created. Please check your email and confirm it before signing in.')
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

      if (lowerMessage.includes('not confirmed') || lowerMessage.includes('email not confirmed')) {
        setError('Please confirm your email before signing in. Check your inbox for the confirmation link.')
        return
      }

      setError(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '60vh',
        gap: '1rem',
      }}
    >
      <h1>{mode === 'sign-up' ? 'Create account' : 'Login'}</h1>

      <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: 'min(420px, 90vw)' }}>
        <div style={{ textAlign: 'left', fontSize: '0.85rem', color: '#666', marginTop: '-0.2rem' }}>
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

        {error && <p role="alert" style={{ color: '#ffb4b4', margin: 0 }}>{error}</p>}
        {message && <p role="status" style={{ color: '#b7f7c7', margin: 0 }}>{message}</p>}

        {mode === 'sign-up' && (
          <div style={{ fontSize: '0.8rem', color: '#666', textAlign: 'left' }}>
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