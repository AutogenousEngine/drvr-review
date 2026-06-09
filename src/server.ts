/**
 * @drvr/review/server — server entry.
 *
 * Server-only: pulls in the Supabase service-role admin client, SSR cookie
 * handling, and the Next.js route handlers. Do NOT import this from client
 * components — it would drag server-only code (and the service role key path)
 * into the browser bundle. Use `@drvr/review` for the client contract instead.
 *
 * (We intentionally omit `import 'server-only'` so the package typechecks
 * standalone without that peer; consuming Next apps still get client/server
 * separation via the split entry points.)
 */

// --- Parameterized server helpers ---
export {
  validateReviewToken,
  createAdminClient,
  ensureReviewerRole,
  reviewCookieOptions,
  reviewerBlockedJsonResponse,
  DEFAULT_REVIEW_DASHBOARD_URL,
} from './reviewerServer'
export type { ReviewConfig, TokenValidationResult } from './reviewerServer'

// --- Route handlers (the per-app touchpoints) ---
export { handleReviewAccess } from './handlers/access'
export { handleReviewAuth } from './handlers/auth'

// --- Convenience re-export: pure helper apps use in mutating-route guards ---
export { isReviewerUser } from './reviewMode'
