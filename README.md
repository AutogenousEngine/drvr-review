# @drvr/review

Shared **DRVR Inkling review-integration** package. It is the single source of
truth for the reviewer flow that client apps embed when they run inside the DRVR
annotation shell (the iframe the dashboard opens at `/review/access?review_token=…`).

Previously every client app *copied* these files out of the
`ember project bootstrap` scaffold and drifted over time. Apps now **import**
this package and supply a tiny per-app config instead of forking the code.

It ships **raw TypeScript** (no build step). Consumers transpile it with Next's
`transpilePackages`.

## What's inside

- **The cross-fleet postMessage contract** (`reviewMode.ts`) — message types
  `review:route` / `review:scroll`, the `review:readonly` event, the
  `review_token` query param, `reviewer` role, and the `x-reviewer-read-only`
  header. These values are an **invariant protocol** shared with
  `drvr-dashboard/static/review_tool.js` — do not change them.
- **Client components** — `ReviewModeClient` (banner + route/scroll bridges,
  no-op outside a review iframe), `ReviewAuthClient` (reviewer sign-in form),
  and `ReviewErrorPage` / `ReviewExpiredPage` terminal screens.
- **Server helpers + route handlers** — `validateReviewToken`,
  `createAdminClient`, `ensureReviewerRole`, `reviewCookieOptions`,
  `reviewerBlockedJsonResponse`, `isReviewerUser`, plus the two route handlers
  `handleReviewAccess` and `handleReviewAuth`.

Client and server code are split across two entry points so server-only code
(service-role admin client, SSR cookies) never lands in the browser bundle:

| Import | Use from |
| --- | --- |
| `@drvr/review` | client components + the pure contract (safe anywhere) |
| `@drvr/review/server` | route handlers + server helpers (server only) |

## Install

Add it as a git dependency pinned to a tag, and tell Next to transpile it:

```jsonc
// package.json
{
  "dependencies": {
    "@drvr/review": "github:AutogenousEngine/drvr-review#v0.1.0"
  }
}
```

```js
// next.config.js  (or next.config.ts)
const nextConfig = {
  transpilePackages: ['@drvr/review'],
}
module.exports = nextConfig
```

Peer deps (already present in a Next + Supabase app): `react`, `react-dom`,
`next`, `@supabase/supabase-js`, `@supabase/ssr`.

## Config API

Server entry points are parameterized with a single config object — no per-app
value is hardcoded in the package (this replaces the scaffold's
`@@PROJECT_SLUG@@` substitution and its hardcoded dashboard URL / landing path):

```ts
export type ReviewConfig = {
  project: string          // required — e.g. 'medlegal-pro'. Used for the token's
                           // project-match check (rejects tokens minted for other apps).
  landingPath?: string     // post-auth redirect. Default '/dashboard'.
  dashboardUrl?: string    // DRVR dashboard base URL. Default:
                           // process.env.REVIEW_DASHBOARD_URL || 'https://drvr-dashboard.fly.dev'
}
```

`validateReviewToken(token, { project, dashboardUrl })` takes only the subset it
needs; `handleReviewAccess` / `handleReviewAuth` take the full `ReviewConfig`.

## Environment variables

Read from `process.env` by the server helpers (set these as app/Fly secrets):

| Var | Purpose |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (anon + admin clients). |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (SSR auth client). |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role key — grants the reviewer role. |
| `REVIEW_DASHBOARD_URL` | Optional. Override the DRVR dashboard base URL (else `config.dashboardUrl`, else the default). |

## The 3 per-app touchpoints

A consuming app stays thin — these are the only files it writes.

### 1. Review routes (handlers + pages)

`app/review/access/route.ts`:

```ts
import { handleReviewAccess } from '@drvr/review/server'
import type { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'
export const GET = (req: NextRequest) =>
  handleReviewAccess(req, { project: 'medlegal-pro', landingPath: '/dashboard' })
```

`app/api/review/auth/route.ts`:

```ts
import { handleReviewAuth } from '@drvr/review/server'
import type { NextRequest } from 'next/server'

export const dynamic = 'force-dynamic'
export const POST = (req: NextRequest) =>
  handleReviewAuth(req, { project: 'medlegal-pro' })
```

`app/review/auth/page.tsx` (validate the token server-side, then render the
form — `validateReviewToken` takes the same config):

```tsx
import { redirect } from 'next/navigation'
import { validateReviewToken } from '@drvr/review/server'
import { ReviewAuthClient } from '@drvr/review'

export default async function ReviewAuthPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const params = await searchParams
  const token = typeof params.review_token === 'string' ? params.review_token.trim() : ''
  if (!token) redirect('/review/error')

  const validation = await validateReviewToken(token, { project: 'medlegal-pro' })
  if (validation.status === 'invalid') redirect('/review/expired')
  if (validation.status === 'error') redirect('/review/error')

  const payload = validation.payload as { project?: string; client_email?: string }
  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 px-4">
      <ReviewAuthClient
        reviewToken={token}
        clientEmail={payload.client_email ?? ''}
        projectName={payload.project ?? 'the app'}
      />
    </div>
  )
}
```

`app/review/error/page.tsx` and `app/review/expired/page.tsx` (terminal pages —
re-export the components; keep the route paths so redirects don't 404):

```tsx
// app/review/error/page.tsx
export { ReviewErrorPage as default } from '@drvr/review'
export const metadata = { title: 'Review session error' }
```

```tsx
// app/review/expired/page.tsx
export { ReviewExpiredPage as default } from '@drvr/review'
export const metadata = { title: 'Review link expired' }
```

### 2. Mount the bridge in the root layout

`app/layout.tsx` — mount once; it renders nothing outside a review iframe:

```tsx
import { ReviewModeClient } from '@drvr/review'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <ReviewModeClient />
      </body>
    </html>
  )
}
```

### 3. Read-only guard on mutating routes

In any route handler / server action that mutates data, block reviewers:

```ts
import { isReviewerUser, reviewerBlockedJsonResponse } from '@drvr/review/server'

// ...after you've loaded the Supabase user:
if (isReviewerUser(user)) {
  return reviewerBlockedJsonResponse() // uniform 403 + x-reviewer-read-only header
}
```

Client-side, mutating Supabase calls made while review mode is active should be
intercepted and surface the read-only toast; `shouldBlockSupabaseMutation`,
`dispatchReviewReadOnlyEvent`, and `createReviewBlockedResponse` (all from
`@drvr/review`) back that pattern, and `ReviewModeClient` shows the toast in
response to the `review:readonly` event.

## Light theming (optional)

The client components accept optional props so an app can rebrand without
forking: `ReviewModeClient` (`bannerText`, `readOnlyToastText`,
`bannerClassName`), `ReviewAuthClient` (`authPath`, `accessPath`,
`accentClassName`), and the error/expired pages (`eyebrow`, `heading`, `body`).
All default to the original copy/styling.

## Development

```bash
npm install        # peer + dev deps (for typecheck only)
npm run typecheck  # tsc --noEmit
```

No build step — the package ships `src/*.ts(x)` directly and relies on the
consuming app's `transpilePackages`.
