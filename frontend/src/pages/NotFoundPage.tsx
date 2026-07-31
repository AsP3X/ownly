// Human: Unknown routes show a 404 without redirecting — reload keeps the same URL for debugging and bookmarks.
// Agent: STATIC page; NO Navigate; USED by App catch-all route.

import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-surface px-6 text-center text-ink">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="max-w-md text-sm text-ink-muted">
        This address does not match a page in Ownly. Check the URL or return home.
      </p>
      <Link
        to="/"
        className="rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-brand-on hover:bg-brand-hover"
      >
        Go to home
      </Link>
    </div>
  );
}
