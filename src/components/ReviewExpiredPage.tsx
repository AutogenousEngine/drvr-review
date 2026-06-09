/**
 * ReviewExpiredPage — shown when a review link is past its TTL or unknown.
 *
 * The review flow redirects here when the dashboard reports the token is
 * invalid/expired (HTTP 404/410 or `valid:false`). Review links are
 * time-boxed (default 3 days). Both the /review/access handler and the
 * /review/auth page redirect to this path, so the consuming app must mount it
 * at `/review/expired` or those redirects 404. It is a terminal, static
 * component — no token is required.
 *
 * Extracted from the `ember project bootstrap` scaffold into the
 * `@drvr/review` package. Re-export it from a server route, or pass props to
 * lightly restyle. Keep the route path (`/review/expired`) and avoid linking
 * to app-specific routes — an expired reviewer has no valid in-app destination.
 */
export interface ReviewExpiredPageProps {
  eyebrow?: string
  heading?: string
  body?: string
}

export default function ReviewExpiredPage({
  eyebrow = 'Review link expired',
  heading = 'This review link has expired.',
  body = 'Review links are time-limited for security. Ask the person who invited you to generate a new review link, then open the fresh URL to continue.',
}: ReviewExpiredPageProps = {}) {
  return (
    <main className="min-h-screen flex items-center justify-center bg-zinc-50 dark:bg-zinc-950 px-4 py-10">
      <section className="w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-8 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
        <p className="text-xs font-medium uppercase tracking-wider text-zinc-500 dark:text-zinc-400">
          {eyebrow}
        </p>
        <h1 className="mt-3 text-xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
          {heading}
        </h1>
        <p className="mt-4 text-sm leading-6 text-zinc-600 dark:text-zinc-300">
          {body}
        </p>
      </section>
    </main>
  )
}
