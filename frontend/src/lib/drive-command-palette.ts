// Human: Command definitions and relevance ranking behind the drive's ⌘K palette.
// Agent: PURE; DriveCommandPalette owns fetching, DrivePage owns what each command does.

/** Human: Commands the palette offers alongside file and folder hits. */
export type DriveCommandActionId =
  | "upload"
  | "new-folder"
  | "go-home"
  | "go-my-files"
  | "go-shared-files"
  | "go-recycle-bin";

export type DriveCommandAction = {
  id: DriveCommandActionId;
  label: string;
  /** Human: Extra words that should match this command beyond the words in its label. */
  keywords: string[];
};

export const DRIVE_COMMAND_ACTIONS: readonly DriveCommandAction[] = [
  { id: "upload", label: "Upload files", keywords: ["add", "import", "new"] },
  { id: "new-folder", label: "New folder", keywords: ["create", "directory"] },
  { id: "go-my-files", label: "Go to My Cloud", keywords: ["browse", "files", "library"] },
  { id: "go-home", label: "Go to Home", keywords: ["overview", "recent", "start"] },
  { id: "go-shared-files", label: "Go to Shared Files", keywords: ["links", "with me"] },
  { id: "go-recycle-bin", label: "Go to Recycle bin", keywords: ["trash", "deleted", "restore"] },
];

/** Human: Characters that start a new word inside a file name, for word-prefix matching. */
const WORD_BOUNDARY = /[\s\-_.]/;

/**
 * Human: How well a name answers a query — lower sorts first.
 * Agent: 0 exact, 1 name prefix, 2 word prefix, 3 anywhere, 4 no match; query is trimmed by callers.
 */
export function scoreNameMatch(name: string, query: string): number {
  const haystack = name.toLowerCase();
  const needle = query.toLowerCase();
  if (needle.length === 0) return 0;
  if (haystack === needle) return 0;
  if (haystack.startsWith(needle)) return 1;

  const index = haystack.indexOf(needle);
  if (index < 0) return 4;
  return WORD_BOUNDARY.test(haystack[index - 1] ?? "") ? 2 : 3;
}

// Human: Put the most likely hit first — the server orders by name, which buries exact matches.
// Agent: STABLE sort on scoreNameMatch; RETURNS the input order unchanged for an empty query.
export function rankByNameMatch<T extends { name: string }>(items: T[], query: string): T[] {
  if (query.length === 0) return items;
  return [...items].sort(
    (left, right) => scoreNameMatch(left.name, query) - scoreNameMatch(right.name, query),
  );
}

// Human: Commands matching what the user typed, by label or by keyword.
// Agent: RETURNS every command for an empty query so the palette opens with something to do.
export function filterCommandActions(
  query: string,
  actions: readonly DriveCommandAction[] = DRIVE_COMMAND_ACTIONS,
): DriveCommandAction[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [...actions];
  return actions.filter(
    (action) =>
      action.label.toLowerCase().includes(needle) ||
      action.keywords.some((keyword) => keyword.includes(needle)),
  );
}
