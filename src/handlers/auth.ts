/**
 * handleReviewAuth — the POST /api/review/auth handler logic.
 *
 * Receives {review_token, email, password, mode} from ReviewAuthClient.
 * Validates the token, signs the user in (or up) against Supabase, grants
 * the reviewer role via admin API, and returns SameSite=None cookies so the
 * session survives inside the cross-site annotation iframe.
 *
 * Extracted from the `ember project bootstrap` scaffold into the
 * `@drvr/review` package. Per-app values (project, dashboardUrl) come from
 * `ReviewConfig`; Supabase env (NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY /
 * SUPABASE_SERVICE_ROLE_KEY) is still read from process.env.
 */
import { createServerClient } from '@supabase/ssr'
import { NextRequest, NextResponse } from 'next/server'
import { createClient as createSupabaseAdmin } from '@supabase/supabase-js'
import {
  validateReviewToken,
  reviewCookieOptions,
  type ReviewConfig,
} from '../reviewerServer'
import { REVIEWER_ROLE } from '../reviewMode'

type AuthBody = {
  review_token?: string
  email?: string
  password?: string
  mode?: 'signin' | 'signup'
}

export async function handleReviewAuth(
  request: NextRequest,
  config: ReviewConfig,
): Promise<NextResponse> {
  let body: AuthBody
  try {
    body = (await request.json()) as AuthBody
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const token = (body.review_token ?? '').trim()
  const email = (body.email ?? '').trim().toLowerCase()
  const password = body.password ?? ''
  const mode = body.mode === 'signup' ? 'signup' : 'signin'

  if (!token) return NextResponse.json({ error: 'Missing review_token' }, { status: 400 })
  if (!email || !password) {
    return NextResponse.json({ error: 'Email and password are required' }, { status: 400 })
  }

  // Validate the review token + enforce the email gate if present.
  const validation = await validateReviewToken(token, config)
  if (validation.status === 'invalid') {
    return NextResponse.json({ error: 'This review link is no longer valid.' }, { status: 401 })
  }
  if (validation.status === 'error') {
    console.error('[api/review/auth] token validation error:', validation.message)
    return NextResponse.json({ error: 'Review validator is unreachable right now.' }, { status: 502 })
  }

  const expectedEmail = (validation.payload.client_email as string | undefined) ?? ''
  if (expectedEmail && expectedEmail !== email) {
    return NextResponse.json(
      { error: `This review is for ${expectedEmail}. Sign in with that address.` },
      { status: 403 },
    )
  }

  // Build a server-side Supabase client whose cookies are upgraded to
  // SameSite=None so the session survives inside the cross-site iframe.
  let response = NextResponse.json({ ok: true })
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          response = NextResponse.json({ ok: true })
          cookiesToSet.forEach(({ name, value }) =>
            response.cookies.set(name, value, reviewCookieOptions()),
          )
        },
      },
    },
  )

  let userId: string | null = null

  if (mode === 'signup') {
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { role: REVIEWER_ROLE },
        emailRedirectTo: undefined,
      },
    })
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 })
    }
    userId = data.user?.id ?? null
  } else {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 401 })
    }
    userId = data.user?.id ?? null
  }

  if (!userId) {
    return NextResponse.json({ error: 'Authentication did not return a user.' }, { status: 500 })
  }

  // Grant reviewer role via admin API so the next JWT refresh reflects it.
  const adminUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const adminKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (adminUrl && adminKey) {
    const admin = createSupabaseAdmin(adminUrl, adminKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })
    const { error: roleError } = await admin.auth.admin.updateUserById(userId, {
      email_confirm: true,
      app_metadata: { role: REVIEWER_ROLE, user_role: REVIEWER_ROLE },
    })
    if (roleError) {
      console.error('[api/review/auth] ensureReviewerRole failed:', roleError.message)
    }
  } else {
    console.warn('[api/review/auth] SUPABASE_SERVICE_ROLE_KEY missing; reviewer role not granted')
  }

  return response
}
