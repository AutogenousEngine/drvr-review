/**
 * @drvr/review — client entry.
 *
 * Safe to import from client components and the browser bundle. Contains the
 * pure postMessage/read-only contract and the client React components. Server-
 * only helpers (service-role admin client, SSR cookie handlers, route
 * handlers) live in `@drvr/review/server` so they never reach client bundles.
 */

// --- Pure contract (constants, postMessage bridges, read-only helpers) ---
export * from './reviewMode'

// --- Client React components ---
export { default as ReviewModeClient } from './ReviewModeClient'
export type { ReviewModeClientProps } from './ReviewModeClient'

export { default as ReviewAuthClient } from './components/ReviewAuthClient'
export type { ReviewAuthClientProps } from './components/ReviewAuthClient'

export { default as ReviewErrorPage } from './components/ReviewErrorPage'
export type { ReviewErrorPageProps } from './components/ReviewErrorPage'

export { default as ReviewExpiredPage } from './components/ReviewExpiredPage'
export type { ReviewExpiredPageProps } from './components/ReviewExpiredPage'
