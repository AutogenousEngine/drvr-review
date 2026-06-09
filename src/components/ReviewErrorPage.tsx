/**
 * ReviewErrorPage — shown when a review link is missing or fails validation.
 *
 * The review flow redirects here when there is no `review_token` or the
 * dashboard returns a non-recoverable error (network failure, unexpected
 * status). Both the /review/access handler and /review/auth page redirect to
 * this path, so the consuming app must mount it at `/review/error` or those
 * redirects 404. It is a terminal, static component — no token is required.
 *
 * Extracted from the `ember project bootstrap` scaffold into the
 * `@drvr/review` package. Re-export it from a server route, or pass props to
 * lightly restyle. Keep the route path (`/review/error`) and avoid linking to
 * app-specific routes — a failed reviewer has no valid in-app destination.
 */
export interface ReviewErrorPageProps {
  eyebrow?: string
  heading?: string
  body?: string
}

export default function ReviewErrorPage({
  eyebrow = 'Review access error',
  heading = 'Unable to start the review session.',
  body = "The review link is missing or could not be validated. Make sure you're using the full link from your review invitation. If the problem persists, ask the person who sent it to share a fresh link.",
}: ReviewErrorPageProps = {}) {
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
