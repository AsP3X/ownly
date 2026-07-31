// Human: Unknown routes show a 404 without redirecting — reload keeps the same URL for debugging and bookmarks.
// Agent: STATIC page; NO Navigate; USED by App catch-all route. Destination adapts to the session state.

import { Link, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "@/hooks/useAuth";

export default function NotFoundPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { token } = useAuth();

  return (
    <div className="flex min-h-svh items-center justify-center bg-surface px-6 py-16 text-ink">
      <div className="flex w-full max-w-sm flex-col gap-5">
        <div className="flex flex-col gap-2">
          <p className="text-[13px] font-medium text-ink-faint">Error 404</p>
          <h1 className="text-lg font-semibold tracking-tight">Page not found</h1>
          <p className="text-[13px] leading-relaxed text-ink-muted">
            No page is registered at this address. Your files are not affected.
          </p>
        </div>

        {/* Human: Echo the attempted path so a mistyped or stale bookmark is obvious. */}
        <p className="truncate rounded-md border border-edge bg-sunken px-3 py-2 font-mono text-xs text-ink-muted">
          {location.pathname}
        </p>

        <div className="flex items-center gap-2">
          <Link
            to="/"
            className="flex h-9 items-center rounded-md bg-brand px-4 text-sm font-semibold text-brand-on transition-colors hover:bg-brand-hover focus-visible:ring-2 focus-visible:ring-focus/40 focus-visible:outline-none"
          >
            {token ? "Go to my files" : "Go to sign in"}
          </Link>
          <button
            type="button"
            onClick={() => navigate(-1)}
            className="flex h-9 items-center rounded-md border border-edge bg-panel px-4 text-sm font-medium text-ink transition-colors hover:bg-surface focus-visible:ring-2 focus-visible:ring-focus/30 focus-visible:outline-none"
          >
            Go back
          </button>
        </div>
      </div>
    </div>
  );
}
