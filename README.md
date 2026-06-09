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
    "@drvr/review": "github:AutogenousEngine/drvr-review#v0.2.0"
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

> **Peer-dep floor — `@supabase/ssr >= 0.10`.** The server handlers use the
> `cookies.getAll()` / `cookies.setAll()` SSR cookie interface introduced in
> `@supabase/ssr` 0.10. Apps still on an older `@supabase/ssr` **must bump to
> `>= 0.10`** before adopting this package, or `handleReviewAccess` /
> `handleReviewAuth` will fail to compile/run. (`peerDependencies` stays
> permissive — `>=0.10.0 <1` — so the bump is on the consuming app; this note is
> the heads-up.) The other peers — `react`/`react-dom` `>=18`, `next` `>=14`,
> `@supabase/supabase-js` `^2` — match a current Next + Supabase app as-is.

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

  // --- Cross-site / landing options (handleReviewAccess only; all default off,
  //     so apps that don't set them behave exactly as before) ---
  markerCookie?: string    // if set, set `<name>=1` (SameSite=None; Secure; Path=/;
                           // 8h) on the success redirect — the durable signal that
                           // keeps an app's auth cookies cross-site-safe for the
                           // rest of the reviewer session. e.g. 'wr_review'.
  honorNext?: boolean      // default false. If true, redirect to a same-origin-safe
                           // `?next=` param (guarded by normalizeReviewRedirectPath,
                           // falling back to landingPath) instead of landingPath.
  reappendToken?: boolean  // default false. If true, append review_token=<token> to
                           // the success redirect so review mode stays on after landing.
}
```

`validateReviewToken(token, { project, dashboardUrl })` takes only the subset it
needs; `handleReviewAccess` / `handleReviewAuth` take the full `ReviewConfig`.

On the authenticated success redirect, `handleReviewAccess` computes the target
as `honorNext && safe(next) ? next : landingPath` (the `next` param is run
through `normalizeReviewRedirectPath`, which rejects `//host`, non-`/`, and bare
`/`); appends `review_token` when `reappendToken`; and sets `markerCookie` when
provided. The three options together reproduce the writing-room cross-site
landing flow with `{ markerCookie: 'wr_review', honorNext: true, reappendToken: true }`.
`handleReviewAccess` also always copies any auth cookies refreshed during the
session check onto the redirect, so a token refresh mid-access survives.

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
keep the route paths so redirects don't 404).

Wrap the component in a local `Page` — do **not** use
`export { ReviewErrorPage as default }`. A bare re-export trips Next's
typed-routes `PageProps` constraint (the default export is checked against the
generated page-props type, which the imported component's signature doesn't
satisfy); a wrapper sidesteps it:

```tsx
// app/review/error/page.tsx
import { ReviewErrorPage } from '@drvr/review'
export const metadata = { title: 'Review session error' }
export default function Page() {
  return <ReviewErrorPage />
}
```

```tsx
// app/review/expired/page.tsx
import { ReviewExpiredPage } from '@drvr/review'
export const metadata = { title: 'Review link expired' }
export default function Page() {
  return <ReviewExpiredPage />
}
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

**Automatic toast on blocked `fetch`.** `ReviewModeClient` ships a `fetch`
interceptor that fires the read-only event for you whenever a response is the
uniform reviewer-blocked 403 (`x-reviewer-read-only`). It's **on by default**
(`interceptFetch`, only active inside a review session) — so once a server route
returns `reviewerBlockedJsonResponse()`, the toast appears with no extra wiring.
Pass `interceptFetch={false}` to opt out (e.g. you install your own).

The interceptor is also exported standalone:

```ts
import {
  installReviewBlockedFetchInterceptor,
  isReviewerBlockedResponse,
} from '@drvr/review'

// Wrap window.fetch yourself; returns a cleanup that restores the original.
const cleanup = installReviewBlockedFetchInterceptor() // defaults to window
// ...later: cleanup()

// Or test a single response:
if (isReviewerBlockedResponse(res)) showMyOwnToast()
```

It wraps `fetch` non-destructively (passes the original Response/rejection
straight through), is idempotent (double-install is a no-op), and SSR-safe
(no-op when there's no `fetch`).

## Light theming (optional)

The client components accept optional props so an app can rebrand without
forking. All default to the original copy/styling, and the class props are
**full replacements** (not appended overrides) — so a brand style wins without
fighting the defaults via `!important`.

- **`ReviewModeClient`** — `bannerText`, `readOnlyToastText`, `interceptFetch`,
  and `bannerClassName`. When `bannerClassName` is set it **replaces** the whole
  default chip class string (the orange chip); leave it unset to keep the
  default.
- **`ReviewAuthClient`** — `authPath`, `accessPath`, plus two theming props:
  - `accentClassName` **replaces** the default violet button accent
    (`bg-violet-600 hover:bg-violet-700`) while keeping the structural button
    classes — use this for a color-only rebrand.
  - `buttonClassName` **replaces the entire** button `className` (structure +
    accent), ignoring `accentClassName` — use this for total control.
- **error / expired pages** — `eyebrow`, `heading`, `body`.

```tsx
// Color-only accent swap on the auth button:
<ReviewAuthClient {...props} accentClassName="bg-emerald-600 hover:bg-emerald-700" />

// Fully restyled review banner (replaces the default chip):
<ReviewModeClient bannerClassName="rounded-md bg-black/80 px-2 py-1 text-xs text-white" />
```

## Development

```bash
npm install        # peer + dev deps (for typecheck only)
npm run typecheck  # tsc --noEmit
```

No build step — the package ships `src/*.ts(x)` directly and relies on the
consuming app's `transpilePackages`.
