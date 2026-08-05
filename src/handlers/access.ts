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

  // NextResponse.next() cookies don't transfer to a redirect, so carry any auth
  // cookies refreshed during getUser() onto every redirect this handler returns.
  // getUser() can rotate the refresh token; a redirect that drops the newly-set
  // cookie strands the browser holding an already-used refresh token, which
  // GoTrue revokes on next use — killing the session a different way.
  const withSessionCookies = (redirect: NextResponse) => {
    for (const cookie of response.cookies.getAll()) {
      redirect.cookies.set(cookie)
    }
    return redirect
  }

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

      const redirectResponse = withSessionCookies(NextResponse.redirect(destination))
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
    // Wrong email — fall through to the auth page.
    //
    // Deliberately NO signOut() here (2026-08-05 confused-deputy logout
    // incident). This handler runs server-side inside a cross-site review
    // iframe that carries the HOST BROWSER's cookies, so the session it sees
    // belongs to whoever is signed in to the app in that browser — not to the
    // review flow. supabase-js signOut() defaults to scope 'global', revoking
    // that user's sessions on every device, so every dashboard iframe load
    // minted for a different email silently logged the real user out
    // everywhere. This context does not own the session, so it must destroy
    // nothing — not even scope 'local'. Nothing needs destroying anyway:
    // signing in at /review/auth (POST /api/review/auth → signInWithPassword)
    // replaces the session in this context.
    //
    // The email gate is unchanged: a mismatched user still gets no review
    // access, they just fall through to /review/auth as before.
  }

  const authUrl = new URL('/review/auth', getExternalOrigin(request))
  authUrl.searchParams.set('review_token', token)
  return withSessionCookies(NextResponse.redirect(authUrl))
}
