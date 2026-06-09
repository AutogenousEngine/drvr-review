'use client'

/**
 * Mounts the banner + postMessage bridges (route changes, scroll) when this
 * app is embedded in the DRVR review annotation shell.
 *
 * Extracted from the `ember project bootstrap` scaffold into the
 * `@drvr/review` package. Mount it once from the root layout with
 * `<ReviewModeClient />`. It renders nothing outside a review iframe.
 *
 * Optional props let an app lightly theme the banner/toast without forking.
 * Defaults reproduce the original orange "Review Session · Read-only" chip.
 */
import { useEffect, useRef, useState } from 'react'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  enableReviewMode,
  installReviewBlockedFetchInterceptor,
  installReviewRouteListeners,
  installReviewScrollBridge,
  isReviewModeEnabled,
  postReviewRouteMessage,
  REVIEW_MODE_BLOCKED_EVENT,
  REVIEWER_READ_ONLY_MESSAGE,
} from './reviewMode'

const TOAST_DURATION_MS = 2600

/** Default banner chip classes — the original orange "Review Session" chip. */
const DEFAULT_BANNER_CLASS =
  'rounded-full border border-orange-900/30 bg-orange-50/95 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-orange-900 shadow-lg backdrop-blur dark:border-orange-200/20 dark:bg-orange-950/90 dark:text-orange-100'

export interface ReviewModeClientProps {
  /** Banner chip text. Default: 'Review Session · Read-only'. */
  bannerText?: string
  /** Read-only toast text. Default: the shared REVIEWER_READ_ONLY_MESSAGE. */
  readOnlyToastText?: string
  /**
   * Banner chip classes. When provided, this **fully replaces** the default
   * chip styling (no merge) — so an app can rebrand the banner without fighting
   * the defaults via `!important`. Leave unset to keep the original orange chip.
   */
  bannerClassName?: string
  /**
   * When true (default), install a `fetch` interceptor for the duration of the
   * review session that auto-fires the read-only event (→ toast) on any
   * reviewer-blocked 403 (`x-reviewer-read-only`). Set false to opt out (e.g.
   * if the app installs its own interceptor or surfaces the toast another way).
   */
  interceptFetch?: boolean
}

export default function ReviewModeClient({
  bannerText = 'Review Session · Read-only',
  readOnlyToastText = REVIEWER_READ_ONLY_MESSAGE,
  bannerClassName,
  interceptFetch = true,
}: ReviewModeClientProps = {}) {
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [reviewModeFromStorage, setReviewModeFromStorage] = useState(false)
  const [showReadOnlyToast, setShowReadOnlyToast] = useState(false)
  const lastHrefRef = useRef('')
  const search = searchParams.toString()
  const reviewModeEnabled = searchParams.has('review_token') || reviewModeFromStorage

  function syncReviewMode() {
    if (typeof window === 'undefined') return false
    if (searchParams.has('review_token')) {
      enableReviewMode(window.sessionStorage)
    }
    return isReviewModeEnabled({
      search: window.location.search,
      storage: window.sessionStorage,
    })
  }

  function broadcastCurrentRoute() {
    if (typeof window === 'undefined') return
    const enabled = syncReviewMode()
    if (!enabled) return
    const href = window.location.href
    if (lastHrefRef.current === href) return
    lastHrefRef.current = href
    postReviewRouteMessage(window)
  }

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const frame = window.requestAnimationFrame(() => {
      setReviewModeFromStorage(syncReviewMode())
    })
    return () => window.cancelAnimationFrame(frame)
  }, [search]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    const frame = window.requestAnimationFrame(() => { broadcastCurrentRoute() })
    return () => window.cancelAnimationFrame(frame)
  }, [pathname, search]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    return installReviewRouteListeners(window, () => {
      const enabled = syncReviewMode()
      setReviewModeFromStorage(enabled)
      if (!enabled) return
      const href = window.location.href
      if (lastHrefRef.current === href) return
      lastHrefRef.current = href
      postReviewRouteMessage(window)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Scroll bridge: forward scroll/resize events to the parent review shell
  // so drawing annotations anchor to the document (and scroll with content)
  // rather than floating over the viewport. No-op outside an iframe.
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    if (!reviewModeEnabled) return undefined
    return installReviewScrollBridge(window)
  }, [reviewModeEnabled])

  // Fetch interceptor: auto-fire the read-only event (→ toast) on any
  // reviewer-blocked 403 so the app doesn't have to wire it per call site.
  // Only active inside a review session, and only when opted in (default on).
  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    if (!interceptFetch) return undefined
    if (!reviewModeEnabled) return undefined
    return installReviewBlockedFetchInterceptor(window)
  }, [interceptFetch, reviewModeEnabled])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    function showToast() { setShowReadOnlyToast(true) }
    window.addEventListener(REVIEW_MODE_BLOCKED_EVENT, showToast)
    return () => window.removeEventListener(REVIEW_MODE_BLOCKED_EVENT, showToast)
  }, [])

  useEffect(() => {
    if (!showReadOnlyToast) return undefined
    const timer = window.setTimeout(() => setShowReadOnlyToast(false), TOAST_DURATION_MS)
    return () => window.clearTimeout(timer)
  }, [showReadOnlyToast])

  if (!reviewModeEnabled) return null

  return (
    <>
      <div className="pointer-events-none fixed right-4 top-4 z-[70]">
        <div className={bannerClassName ?? DEFAULT_BANNER_CLASS}>
          {bannerText}
        </div>
      </div>

      {showReadOnlyToast && (
        <div className="pointer-events-none fixed bottom-5 left-1/2 z-[70] -translate-x-1/2 px-4">
          <div className="rounded-2xl border border-orange-900/25 bg-orange-50/95 px-4 py-3 text-sm font-medium text-orange-900 shadow-lg backdrop-blur dark:border-orange-200/20 dark:bg-orange-950/95 dark:text-orange-100">
            {readOnlyToastText}
          </div>
        </div>
      )}
    </>
  )
}
