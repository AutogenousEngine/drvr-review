/**
 * handleReviewAccess — the GET /review/access handler logic.
 *
 * Entry point for the review flow inside the annotation iframe. The DRVR
 * dashboard annotation tool sources the iframe with:
 *   https://<this-app>/review/access?review_token=<token>
 *
 * This handler:
 *   1. Validates the token against the DRVR dashboard (using config.project
 *      + config.dashboardUrl).
 *   2. If the user is already signed in with the right email → grant
 *      reviewer role → redirect to config.landingPath (default '/dashboard').
 *   3. If no session or wrong email → redirect to /review/auth with the
 *      token preserved.
 *   4. If no client_email on the minted review (legacy shared-reviewer flow)
 *      → skip the email gate but still require an authenticated session.
 *
 * Extracted from the `ember project bootstrap` scaffold into the
 * `@drvr/review` package. Per-app values come from `ReviewConfig`; Supabase
 * env (NEXT_PUBLIC_SUPABASE_URL / _ANON_KEY / SUPABASE_SERVICE_ROLE_KEY) is
 * still read from process.env.
 */
import { NextRequest, NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import {
  validateReviewToken,
  ensureReviewerRole,
  reviewCookieOptions,
  type ReviewConfig,
} from '../reviewerServer'

function getExternalOrigin(request: NextRequest): string {
  const proto = request.headers.get('x-forwarded-proto') ?? 'https'
  const host =
    request.headers.get('x-forwarded-host') ??
    request.headers.get('host') ??
    'localhost:3000'
  return `${proto}://${host}`
}

export async function handleReviewAccess(
  request: NextRequest,
  config: ReviewConfig,
): Promise<NextResponse> {
  const landingPath = config.landingPath ?? '/dashboard'
  const { searchParams } = request.nextUrl
  const token = searchParams.get('review_token') ?? ''

  if (!token) {
    return NextResponse.redirect(new URL('/review/error', getExternalOrigin(request)))
  }

  const validation = await validateReviewToken(token, config)
  if (validation.status === 'invalid') {
    return NextResponse.redirect(new URL('/review/expired', getExternalOrigin(request)))
  }
  if (validation.status === 'error') {
    console.error('[review/access] token validation error:', validation.message)
    return NextResponse.redirect(new URL('/review/error', getExternalOrigin(request)))
  }

  const clientEmail = (validation.payload.client_email as string | undefined) ?? ''

  let response = NextResponse.next()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() { return request.cookies.getAll() },
        setAll(cookiesToSet) {
          response = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value }) =>
            response.cookies.set(name, value, reviewCookieOptions()),
          )
        },
      },
    },
  )

  const { data: { user } } = await supabase.auth.getUser()

  if (user) {
    const userEmail = user.email ?? ''
    const emailOk = !clientEmail || userEmail === clientEmail
    if (emailOk) {
      await ensureReviewerRole(user.id)
      return NextResponse.redirect(new URL(landingPath, getExternalOrigin(request)))
    }
    // Wrong email — sign out and fall through to auth page.
    await supabase.auth.signOut()
  }

  const authUrl = new URL('/review/auth', getExternalOrigin(request))
  authUrl.searchParams.set('review_token', token)
  return NextResponse.redirect(authUrl)
}
