import { useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { supabase } from '../utils/supabase/supabase-client'
import { isDevLoginEnabled } from '../utils/dev-login'

type AuthMode = 'sign-in' | 'sign-up'

type FormState = {
  signupCode: string
  name: string
  costume: string
  email: string
  password: string
}

const initialForm: FormState = {
  signupCode: '',
  name: '',
  costume: '',
  email: '',
  password: '',
}

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const isValidEmail = (value: string) => EMAIL_REGEX.test(value.trim())

const COSTUME_TAKEN_MESSAGE = 'Someone already has that costume. Please pick another one.'
const INVALID_SIGNUP_CODE_MESSAGE = 'Dieser Code hilft dir nicht, frag Rubik nach einem SignUp Code'

type AuthProps = {
  onDevLogin?: () => void
}

export const Auth = ({ onDevLogin }: AuthProps) => {
  const [mode, setMode] = useState<AuthMode>('sign-in')
  const [form, setForm] = useState<FormState>(initialForm)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)

  const handleDevLogin = () => {
    if (!isDevLoginEnabled()) {
      return
    }

    setMessage('Developer login successful.')
    onDevLogin?.()
  }

  const updateField =
    (field: keyof FormState) => (event: ChangeEvent<HTMLInputElement>) => {
      const value = event.target.value
      setForm((current) => ({ ...current, [field]: value }))
    }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setError('')
    setMessage('')

    if (isDevLoginEnabled()) {
      handleDevLogin()
      return
    }

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
        const cleanedSignupCode = form.signupCode.trim()

        const { data: costumeFree, error: costumeError } = await supabase.rpc('costume_available', {
          p_costume: cleanedCostume,
        })
        if (!costumeError && costumeFree === false) {
          setError(COSTUME_TAKEN_MESSAGE)
          return
        }

        const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
          email: cleanedEmail,
          password: form.password,
          options: {
            data: {
              name: cleanedName,
              costume: cleanedCostume,
              signup_code: cleanedSignupCode,
            },
          },
        })

        if (signUpError) {
          throw signUpError
        }

        if (!signUpData.session) {
          const { error: autoSignInError } = await supabase.auth.signInWithPassword({
            email: cleanedEmail,
            password: form.password,
          })

          if (autoSignInError) {
            throw autoSignInError
          }
        }

        setForm(initialForm)
        setMessage('Automatically signed in.')
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

      // Auth reports a rejected signup code only as a generic database error.
      if (mode === 'sign-up' && message.toLowerCase().includes('database error saving new user')) {
        setError(INVALID_SIGNUP_CODE_MESSAGE)
        return
      }

      setError(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="auth-wrap">
      <h1>{mode === 'sign-up' ? 'Sign Up' : 'Sign In'}</h1>

      {isDevLoginEnabled() && (
        <div style={{ marginBottom: '1rem' }}>
          <button type="button" onClick={handleDevLogin}>
            Developer login
          </button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="auth-form">
        <div className="auth-hint">
          {mode === 'sign-up'
            ? 'You need a signup code to create an account.'
            : 'Use the email and password for your existing account.'}
        </div>

        {mode === 'sign-up' && (
          <input
            type="text"
            placeholder="Signup code"
            value={form.signupCode}
            onChange={updateField('signupCode')}
            autoComplete="off"
            required
          />
        )}

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

        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Please wait...' : mode === 'sign-up' ? 'Sign Up' : 'Sign In'}
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