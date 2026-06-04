// Human: Unknown routes show a 404 without redirecting — reload keeps the same URL for debugging and bookmarks.
// Agent: STATIC page; NO Navigate; USED by App catch-all route.

import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[#F7F8FA] px-6 text-center text-[#1A1A1A]">
      <h1 className="text-2xl font-semibold">Page not found</h1>
      <p className="max-w-md text-sm text-[#666666]">
        This address does not match a page in Ownly. Check the URL or return home.
      </p>
      <Link
        to="/"
        className="rounded-lg bg-[#2563EB] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1D4ED8]"
      >
        Go to home
      </Link>
    </div>
  );
}
