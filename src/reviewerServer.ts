/**
 * Server-side helpers for the reviewer persona.
 *
 * Extracted from the `ember project bootstrap` scaffold into the
 * `@drvr/review` package. The per-app project slug is no longer hardcoded
 * (the scaffold replaced `@@PROJECT_SLUG@@`); it is now passed in via
 * `ReviewConfig`.
 *
 * Exports:
 *   - validateReviewToken(token, config): verify a review token against the
 *     DRVR dashboard. `config.project` is required for the project-match
 *     check; `config.dashboardUrl` falls back to
 *     process.env.REVIEW_DASHBOARD_URL || the default. Returns {status, payload}.
 *   - createAdminClient(): a Supabase admin client (service role key) for
 *     server-side user management. Env-driven; no per-app params.
 *   - ensureReviewerRole(userId): stamp app_metadata.role = 'reviewer' so
 *     the user's JWT reflects reviewer scope after the next refresh.
 *   - reviewCookieOptions(): cookie attrs suitable for cross-site iframe
 *     sessions — SameSite=None; Secure; HttpOnly.
 *   - reviewerBlockedJsonResponse(): uniform 403 response when a mutation
 *     is blocked by the read-only reviewer policy.
 */
import { createClient as createSupabaseAdmin, type SupabaseClient } from '@supabase/supabase-js'
import {
  REVIEWER_BLOCKED_HEADER,
  REVIEWER_READ_ONLY_MESSAGE,
  REVIEWER_ROLE,
} from './reviewMode'

export const DEFAULT_REVIEW_DASHBOARD_URL = 'https://drvr-dashboard.fly.dev'

/**
 * Per-app review configuration. Replaces the values the scaffold used to
 * hardcode (`@@PROJECT_SLUG@@` and the default dashboard URL / landing path).
 */
export type ReviewConfig = {
  /** Project slug, e.g. 'medlegal-pro' (replaces @@PROJECT_SLUG@@). Required. */
  project: string
  /** Post-auth redirect landing path. Default '/dashboard'. */
  landingPath?: string
  /**
   * DRVR dashboard base URL. Default:
   * process.env.REVIEW_DASHBOARD_URL || DEFAULT_REVIEW_DASHBOARD_URL.
   */
  dashboardUrl?: string
  /**
   * Durable cross-site marker cookie. If set, `handleReviewAccess` sets
   * `<markerCookie>=1` (SameSite=None; Secure; Path=/) on the authenticated
   * success redirect. This is the non-auth signal that tells an app's Supabase
   * clients / middleware to keep emitting SameSite=None auth cookies for the
   * rest of the reviewer session so Chrome's third-party-cookie partitioning
   * doesn't drop the session mid-review. Unset → no marker cookie (default).
   * Example: 'wr_review'.
   */
  markerCookie?: string
  /**
   * If true, `handleReviewAccess` honors a same-origin-safe `?next=` param on
   * the authenticated success redirect instead of always using `landingPath`.
   * The `next` value is passed through `normalizeReviewRedirectPath`, so unsafe
   * values (protocol-relative `//`, non-`/`, bare `/`) fall back to
   * `landingPath`. Default false (always land on `landingPath`).
   */
  honorNext?: boolean
  /**
   * If true, `handleReviewAccess` appends `review_token=<token>` to the
   * authenticated success redirect URL so review mode stays active after the
   * reviewer lands. Default false.
   */
  reappendToken?: boolean
}

// ---------------------------------------------------------------------------
// Dashboard URL resolution
// ---------------------------------------------------------------------------
function resolveDashboardBaseUrl(dashboardUrl?: string) {
  const raw = (dashboardUrl ?? process.env.REVIEW_DASHBOARD_URL)?.trim() || DEFAULT_REVIEW_DASHBOARD_URL
  return raw.endsWith('/') ? raw.slice(0, -1) : raw
}

// ---------------------------------------------------------------------------
// Admin client (service role — server-side only). Env-driven; no per-app params.
// ---------------------------------------------------------------------------
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnySupabaseClient = SupabaseClient<any, any, any>

type AdminClientResult =
  | { client: AnySupabaseClient; error: null }
  | { client: null; error: string }

export function createAdminClient(): AdminClientResult {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    return { client: null, error: 'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY' }
  }
  const client: AnySupabaseClient = createSupabaseAdmin(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  return { client, error: null }
}

// ---------------------------------------------------------------------------
// Reviewer role grant. Env-driven; no per-app params.
// ---------------------------------------------------------------------------
export async function ensureReviewerRole(
  userId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { client: admin, error } = createAdminClient()
  if (!admin || error) {
    return { ok: false, error: error ?? 'Could not create admin client.' }
  }
  const { error: updateError } = await admin.auth.admin.updateUserById(userId, {
    email_confirm: true,
    app_metadata: { role: REVIEWER_ROLE, user_role: REVIEWER_ROLE },
  })
  if (updateError) return { ok: false, error: updateError.message }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Token validation (asks the DRVR dashboard)
// ---------------------------------------------------------------------------
type ReviewValidationResponse = {
  valid?: boolean
  review_id?: string
  client_key?: string
  client_email?: string
  project?: string
  expires_at?: number
}

export type TokenValidationResult =
  | { status: 'valid'; payload: ReviewValidationResponse }
  | { status: 'invalid' }
  | { status: 'error'; message: string }

/**
 * Validate a review token against the DRVR dashboard.
 *
 * @param token   the raw review token.
 * @param config  `{ project, dashboardUrl? }` — `project` is required and is
 *                used for the project-match check; `dashboardUrl` falls back
 *                to process.env.REVIEW_DASHBOARD_URL || the default.
 */
export async function validateReviewToken(
  token: string,
  config: Pick<ReviewConfig, 'project' | 'dashboardUrl'>,
): Promise<TokenValidationResult> {
  const trimmed = (token || '').trim()
  if (!trimmed) return { status: 'invalid' }

  const url = new URL('/api/review-token/validate', resolveDashboardBaseUrl(config.dashboardUrl))
  url.searchParams.set('t', trimmed)

  let response: Response
  try {
    response = await fetch(url, { cache: 'no-store', next: { revalidate: 0 } })
  } catch (e) {
    return { status: 'error', message: e instanceof Error ? e.message : String(e) }
  }

  if (response.status === 410 || response.status === 404) return { status: 'invalid' }
  if (!response.ok) return { status: 'error', message: `Dashboard returned ${response.status}` }

  let payload: ReviewValidationResponse
  try {
    payload = (await response.json()) as ReviewValidationResponse
  } catch {
    return { status: 'error', message: 'Dashboard returned invalid JSON' }
  }

  if (!payload.valid) return { status: 'invalid' }
  if (payload.project && payload.project !== config.project) {
    // Token is valid but for a different project — treat as invalid for us.
    return { status: 'invalid' }
  }
  if (typeof payload.expires_at === 'number' && payload.expires_at * 1000 <= Date.now()) {
    return { status: 'invalid' }
  }
  return { status: 'valid', payload }
}

// ---------------------------------------------------------------------------
// Cookie options for cross-site iframe (DRVR dashboard embeds this app)
// ---------------------------------------------------------------------------
export function reviewCookieOptions() {
  return {
    sameSite: 'none' as const,
    secure: true,
    httpOnly: true,
    path: '/',
  }
}

// ---------------------------------------------------------------------------
// Uniform blocked response for reviewer-read-only mutations
// ---------------------------------------------------------------------------
export function reviewerBlockedJsonResponse() {
  return new Response(JSON.stringify({ error: REVIEWER_READ_ONLY_MESSAGE }), {
    status: 403,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      [REVIEWER_BLOCKED_HEADER]: '1',
    },
  })
}
