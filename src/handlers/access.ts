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
 *      reviewer role → redirect to the success target. The target is
 *      config.landingPath (default '/dashboard'); if config.honorNext and the
 *      request carries a same-origin-safe `?next=`, that path is used instead.
 *      If config.reappendToken, `review_token` is re-appended to the target so
 *      review mode stays on. If config.markerCookie, that durable cross-site
 *      marker cookie is set on the redirect.
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
import {
  appendReviewToken,
  normalizeReviewRedirectPath,
} from '../reviewMode'

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
  const nextParam = searchParams.get('next')

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

      const origin = getExternalOrigin(request)

      // Success target. `landingPath` is operator-controlled, so it's used
      // verbatim (preserving the original default behavior). Only the untrusted
      // `next` param is run through normalizeReviewRedirectPath, which rejects
      // `//host`, non-`/`, and bare `/`, falling back to landingPath.
      const target =
        config.honorNext && nextParam
          ? normalizeReviewRedirectPath(nextParam, landingPath)
          : landingPath

      // Build the redirect URL, optionally re-appending review_token so review
      // mode stays active after the reviewer lands.
      const destination = config.reappendToken
        ? appendReviewToken(target, token, origin, landingPath)
        : new URL(target, origin)

      const redirectResponse = NextResponse.redirect(destination)
      // NextResponse.next() cookies don't transfer to a redirect — copy any
      // auth cookies refreshed during getUser onto the redirect response.
      for (const cookie of response.cookies.getAll()) {
        redirectResponse.cookies.set(cookie)
      }
      // Durable cross-site marker so the app's Supabase clients keep emitting
      // SameSite=None auth cookies for the rest of this reviewer session.
      if (config.markerCookie) {
        redirectResponse.cookies.set({
          name: config.markerCookie,
          value: '1',
          sameSite: 'none',
          secure: true,
          httpOnly: false,
          path: '/',
          maxAge: 60 * 60 * 8,
        })
      }
      return redirectResponse
    }
    // Wrong email — sign out and fall through to auth page.
    await supabase.auth.signOut()
  }

  const authUrl = new URL('/review/auth', getExternalOrigin(request))
  authUrl.searchParams.set('review_token', token)
  return NextResponse.redirect(authUrl)
}
