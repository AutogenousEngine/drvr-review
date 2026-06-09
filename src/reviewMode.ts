/**
 * Review-mode helpers — shared between the DRVR annotation shell (parent
 * frame) and consuming apps (embedded iframe).
 *
 * Extracted from the `ember project bootstrap` scaffold into the
 * `@drvr/review` package. These constants are project-agnostic on purpose:
 * the DRVR dashboard listens for `review:*` messages from any registered
 * project, so every app speaks the same postMessage dialect.
 *
 * INVARIANT CONTRACT — these values are the cross-fleet protocol. Do NOT
 * rename or change them without coordinating with
 * drvr-dashboard/static/review_tool.js:
 *   REVIEW_MODE_QUERY_PARAM          'review_token'
 *   REVIEW_MODE_ROUTE_MESSAGE_TYPE   'review:route'
 *   REVIEW_MODE_SCROLL_MESSAGE_TYPE  'review:scroll'
 *   REVIEW_MODE_BLOCKED_EVENT        'review:readonly'
 *   REVIEWER_ROLE                    'reviewer'
 *   REVIEWER_BLOCKED_HEADER          'x-reviewer-read-only'
 */
export const REVIEW_MODE_QUERY_PARAM = 'review_token'
export const REVIEW_MODE_STORAGE_KEY = 'review_mode'
export const REVIEW_MODE_ROUTE_MESSAGE_TYPE = 'review:route'
export const REVIEW_MODE_SCROLL_MESSAGE_TYPE = 'review:scroll'
export const REVIEW_MODE_BLOCKED_EVENT = 'review:readonly'
export const REVIEWER_ROLE = 'reviewer'
export const REVIEWER_EMAIL = 'reviewer@example.invalid'
export const REVIEWER_READ_ONLY_MESSAGE = 'Read-only review session.'
export const REVIEWER_BLOCKED_HEADER = 'x-reviewer-read-only'

type ReviewableUser = {
  app_metadata?: Record<string, unknown> | null
  email?: string | null
} | null | undefined

type ReviewLocation = {
  href: string
  pathname: string
}

type ReviewWindow = Window & typeof globalThis

function readStorageValue(storage?: Pick<Storage, 'getItem'> | null) {
  try {
    return storage?.getItem(REVIEW_MODE_STORAGE_KEY) ?? null
  } catch {
    return null
  }
}

export function isReviewerUser(user: ReviewableUser) {
  if (!user) return false
  const metadata = user.app_metadata && typeof user.app_metadata === 'object'
    ? user.app_metadata
    : {}
  return metadata.user_role === REVIEWER_ROLE ||
    metadata.role === REVIEWER_ROLE ||
    user.email === REVIEWER_EMAIL
}

export function hasReviewToken(search: string | URLSearchParams | null | undefined) {
  if (!search) return false
  if (typeof search === 'string') {
    return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).has(REVIEW_MODE_QUERY_PARAM)
  }
  return search.has(REVIEW_MODE_QUERY_PARAM)
}

export function isReviewModeEnabled({
  search,
  storage,
}: {
  search?: string | URLSearchParams | null
  storage?: Pick<Storage, 'getItem'> | null
} = {}) {
  return hasReviewToken(search) || readStorageValue(storage) === '1'
}

export function enableReviewMode(storage?: Pick<Storage, 'setItem'> | null) {
  try {
    storage?.setItem(REVIEW_MODE_STORAGE_KEY, '1')
  } catch { /* private-mode browsers */ }
}

export function buildReviewRouteMessage(location: ReviewLocation) {
  return {
    type: REVIEW_MODE_ROUTE_MESSAGE_TYPE,
    path: location.pathname,
    href: location.href,
    ts: Date.now(),
  }
}

export function postReviewRouteMessage(win: ReviewWindow) {
  if (!isReviewModeEnabled({
    search: win.location.search,
    storage: win.sessionStorage,
  })) {
    return null
  }
  const message = buildReviewRouteMessage(win.location)
  win.parent?.postMessage?.(message, '*')
  return message
}

export function installReviewRouteListeners(win: ReviewWindow, onRouteChange: () => void) {
  const history = win.history
  const originalPushState = history.pushState.bind(history)
  const originalReplaceState = history.replaceState.bind(history)
  history.pushState = function pushState(...args) {
    originalPushState(...args)
    onRouteChange()
  }
  history.replaceState = function replaceState(...args) {
    originalReplaceState(...args)
    onRouteChange()
  }
  win.addEventListener('popstate', onRouteChange)
  return () => {
    history.pushState = originalPushState
    history.replaceState = originalReplaceState
    win.removeEventListener('popstate', onRouteChange)
  }
}

export function shouldBlockSupabaseMutation({
  href,
  method,
  reviewModeEnabled,
}: {
  href: string
  method?: string | null
  reviewModeEnabled: boolean
}) {
  if (!reviewModeEnabled) return false
  const normalizedMethod = (method ?? 'GET').toUpperCase()
  if (normalizedMethod === 'GET' || normalizedMethod === 'HEAD' || normalizedMethod === 'OPTIONS') {
    return false
  }
  let url: URL
  try {
    url = new URL(href, typeof window === 'undefined' ? 'http://localhost' : window.location.origin)
  } catch {
    return false
  }
  return url.pathname.includes('/rest/v1/')
}

/**
 * Open-redirect guard for a post-auth redirect path. Returns `fallback`
 * (default '/dashboard') for empty/unsafe values: anything that isn't a
 * single-leading-slash same-origin path (rejects protocol-relative `//host`,
 * non-`/` absolute URLs, and the bare `/` root). The optional `fallback` lets
 * a consuming app point unsafe values at its own landing path instead of the
 * package default — pass it `landingPath`.
 */
export function normalizeReviewRedirectPath(
  value: string | null | undefined,
  fallback = '/dashboard',
) {
  if (!value || !value.startsWith('/')) return fallback
  if (value.startsWith('//')) return fallback
  if (value === '/') return fallback
  return value
}

/**
 * Re-append `review_token` onto a (normalized) redirect path so review mode
 * stays active after the reviewer lands. The optional `fallback` is forwarded
 * to `normalizeReviewRedirectPath` (default '/dashboard').
 */
export function appendReviewToken(
  path: string,
  token: string,
  origin: string,
  fallback = '/dashboard',
) {
  const url = new URL(normalizeReviewRedirectPath(path, fallback), origin)
  url.searchParams.set('review_token', token)
  return url
}

export function dispatchReviewReadOnlyEvent() {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(REVIEW_MODE_BLOCKED_EVENT))
}

/**
 * True when a fetch Response is the uniform reviewer-blocked 403: HTTP 403 with
 * the `x-reviewer-read-only` header set. Matches the response produced by
 * `reviewerBlockedJsonResponse()` / `createReviewBlockedResponse()`.
 */
export function isReviewerBlockedResponse(res: Response | null | undefined): boolean {
  if (!res) return false
  return res.status === 403 && res.headers.get(REVIEWER_BLOCKED_HEADER) != null
}

/**
 * Wrap `win.fetch` so that any reviewer-blocked 403 (see
 * `isReviewerBlockedResponse`) auto-fires the read-only event — which
 * `ReviewModeClient` turns into the read-only toast. This means a consuming app
 * gets the toast for free on blocked mutations without threading the response
 * through its own handlers.
 *
 * No-op (returns a no-op cleanup) when there is no `fetch` to wrap (e.g. SSR).
 * Returns a cleanup that restores the original fetch. The wrapper never
 * swallows errors or alters the response — it only observes status/header and
 * passes the original Response (or rejection) straight through.
 */
type PatchedFetch = typeof fetch & { __reviewBlockedFetchPatched?: true }

export function installReviewBlockedFetchInterceptor(
  win: ReviewWindow = window,
): () => void {
  if (!win || typeof win.fetch !== 'function') return () => {}
  const originalFetch = win.fetch as PatchedFetch
  // Mark our wrapper so a double-install is idempotent (and a stale cleanup
  // from a previous mount can't clobber a newer wrapper).
  if (originalFetch.__reviewBlockedFetchPatched) return () => {}

  const wrapped = async function reviewBlockedFetch(
    this: unknown,
    ...args: Parameters<typeof fetch>
  ): Promise<Response> {
    const res = await originalFetch.apply(this, args)
    try {
      if (isReviewerBlockedResponse(res)) dispatchReviewReadOnlyEvent()
    } catch { /* never let the toast hook break the request */ }
    return res
  } as PatchedFetch
  wrapped.__reviewBlockedFetchPatched = true
  win.fetch = wrapped

  return () => {
    // Only restore if we're still the active wrapper (avoid clobbering a newer
    // interceptor installed after us).
    if (win.fetch === wrapped) win.fetch = originalFetch
  }
}

export function createReviewBlockedResponse() {
  return new Response(JSON.stringify({ error: REVIEWER_READ_ONLY_MESSAGE }), {
    status: 403,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      [REVIEWER_BLOCKED_HEADER]: '1',
    },
  })
}

// ---------------------------------------------------------------------------
// Scroll bridge — tell the parent shell when the app scrolls so drawings
// anchor to document coordinates, not viewport.
// ---------------------------------------------------------------------------

export type ReviewScrollMessage = {
  type: typeof REVIEW_MODE_SCROLL_MESSAGE_TYPE
  scrollX: number
  scrollY: number
  documentWidth: number
  documentHeight: number
  viewportWidth: number
  viewportHeight: number
  ts: number
}

export function buildReviewScrollMessage(win: ReviewWindow): ReviewScrollMessage {
  const doc = win.document.documentElement
  return {
    type: REVIEW_MODE_SCROLL_MESSAGE_TYPE,
    scrollX: win.scrollX,
    scrollY: win.scrollY,
    documentWidth: doc.scrollWidth,
    documentHeight: doc.scrollHeight,
    viewportWidth: win.innerWidth,
    viewportHeight: win.innerHeight,
    ts: Date.now(),
  }
}

export function postReviewScrollMessage(win: ReviewWindow) {
  if (win.parent === win) return null
  if (!isReviewModeEnabled({
    search: win.location.search,
    storage: win.sessionStorage,
  })) return null
  const message = buildReviewScrollMessage(win)
  win.parent?.postMessage?.(message, '*')
  return message
}

export function installReviewScrollBridge(win: ReviewWindow) {
  if (win.parent === win) return () => {}

  let frame: number | null = null
  let lastX = Number.NaN, lastY = Number.NaN, lastDW = Number.NaN, lastDH = Number.NaN

  const send = () => {
    frame = null
    const doc = win.document.documentElement
    const x = win.scrollX, y = win.scrollY
    const dw = doc.scrollWidth, dh = doc.scrollHeight
    if (x === lastX && y === lastY && dw === lastDW && dh === lastDH) return
    lastX = x; lastY = y; lastDW = dw; lastDH = dh
    postReviewScrollMessage(win)
  }
  const schedule = () => { if (frame === null) frame = win.requestAnimationFrame(send) }

  send()
  win.addEventListener('scroll', schedule, { passive: true, capture: true })
  win.addEventListener('resize', schedule)

  let resizeObserver: ResizeObserver | null = null
  if (typeof ResizeObserver === 'function') {
    resizeObserver = new ResizeObserver(schedule)
    resizeObserver.observe(win.document.documentElement)
    if (win.document.body) resizeObserver.observe(win.document.body)
  }

  return () => {
    win.removeEventListener('scroll', schedule, { capture: true } as EventListenerOptions)
    win.removeEventListener('resize', schedule)
    resizeObserver?.disconnect()
    if (frame !== null) win.cancelAnimationFrame(frame)
  }
}
