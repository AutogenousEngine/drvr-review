'use client'

/**
 * ReviewAuthClient — self-contained sign-in / sign-up form for review
 * sessions.
 *
 * Shown when a client opens their review link and isn't signed in yet.
 * At mint time, Ember automatically creates a Supabase account and sends
 * the credentials via Telegram, so this page defaults to sign-in mode.
 *
 * When `clientEmail` is provided, the email field is pre-filled and
 * locked — the reviewer must sign in as that specific address.
 *
 * Extracted from the `ember project bootstrap` scaffold into the
 * `@drvr/review` package. Styling uses Tailwind classes that work
 * out-of-the-box in any Next.js + Tailwind app. Optional props (`authPath`,
 * `accessPath`, `accentClassName`) let an app theme/rewire lightly without
 * forking; defaults reproduce the original behavior.
 */
import { useState } from 'react'

export interface ReviewAuthClientProps {
  reviewToken: string
  clientEmail: string
  projectName: string
  /** POST endpoint backing the form. Default '/api/review/auth'. */
  authPath?: string
  /** Path the form navigates to on success. Default '/review/access'. */
  accessPath?: string
  /**
   * Classes for the submit button + links, for light brand theming.
   * Default reproduces the violet accent.
   */
  accentClassName?: string
}

type Mode = 'signin' | 'signup'

export default function ReviewAuthClient({
  reviewToken,
  clientEmail,
  projectName,
  authPath = '/api/review/auth',
  accessPath = '/review/access',
  accentClassName = 'bg-violet-600 hover:bg-violet-700',
}: ReviewAuthClientProps) {
  const [mode, setMode] = useState<Mode>('signin')
  const [email, setEmail] = useState(clientEmail)
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const emailLocked = Boolean(clientEmail)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const res = await fetch(authPath, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ review_token: reviewToken, email, password, mode }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error ?? 'Something went wrong. Please try again.')
        setLoading(false)
        return
      }

      // Full browser navigation so cookies land before /review/access fires.
      window.location.href = `${accessPath}?review_token=${encodeURIComponent(reviewToken)}`
    } catch {
      setError('Network error. Please check your connection and try again.')
      setLoading(false)
    }
  }

  return (
    <div className="w-full max-w-sm">
      <div className="text-center mb-8">
        <h1 className="text-2xl font-semibold text-zinc-900 dark:text-white">
          {mode === 'signin' ? 'Sign in to review' : 'Create your account'}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {mode === 'signin'
            ? `Sign in to annotate ${projectName}`
            : `Set up access to annotate ${projectName}`}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label
            htmlFor="email"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1"
          >
            Email
          </label>
          <input
            id="email"
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            readOnly={emailLocked}
            className={[
              'w-full px-3 py-2 rounded-lg border text-sm',
              'bg-white dark:bg-zinc-900',
              'text-zinc-900 dark:text-white',
              'border-zinc-300 dark:border-zinc-700',
              'focus:outline-none focus:ring-2 focus:ring-violet-500',
              emailLocked ? 'opacity-60 cursor-not-allowed' : '',
            ].join(' ')}
            placeholder="your@email.com"
            autoComplete="email"
          />
          {emailLocked && (
            <p className="mt-1 text-xs text-zinc-400">
              This review is for {clientEmail}
            </p>
          )}
        </div>

        <div>
          <label
            htmlFor="password"
            className="block text-sm font-medium text-zinc-700 dark:text-zinc-300 mb-1"
          >
            Password
          </label>
          <input
            id="password"
            type="password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full px-3 py-2 rounded-lg border text-sm bg-white dark:bg-zinc-900 text-zinc-900 dark:text-white border-zinc-300 dark:border-zinc-700 focus:outline-none focus:ring-2 focus:ring-violet-500"
            placeholder="••••••••"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
          />
          {mode === 'signin' && (
            <p className="mt-1 text-xs text-zinc-400">
              Check the message from your project bot for your password.
            </p>
          )}
        </div>

        {error && (
          <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className={[
            'w-full py-2.5 rounded-lg disabled:opacity-50 text-white font-medium text-sm transition-colors',
            accentClassName,
          ].join(' ')}
        >
          {loading
            ? mode === 'signin' ? 'Signing in…' : 'Creating account…'
            : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
      </form>

      <p className="mt-5 text-center text-sm text-zinc-500 dark:text-zinc-400">
        {mode === 'signin' ? (
          <>
            Don&apos;t have an account?{' '}
            <button
              onClick={() => { setMode('signup'); setError(null) }}
              className="text-violet-600 hover:underline font-medium"
            >
              Sign up
            </button>
          </>
        ) : (
          <>
            Already have an account?{' '}
            <button
              onClick={() => { setMode('signin'); setError(null) }}
              className="text-violet-600 hover:underline font-medium"
            >
              Sign in
            </button>
          </>
        )}
      </p>
    </div>
  )
}
