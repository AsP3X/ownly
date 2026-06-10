// Human: Central browser logger — gates console output by VITE_LOG_LEVEL (default debug).
// Agent: READS import.meta.env.VITE_LOG_LEVEL; CALLS console.*; DEFAULT debug logs debug/info/warn/error.

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "silent";

const LEVEL_RANK: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  silent: 5,
};

// Human: Unknown env values fall back to debug so local stacks stay verbose without extra config.
// Agent: PARSES VITE_LOG_LEVEL at module load and again in initLogger after env is finalized.
function resolveLogLevel(): LogLevel {
  const raw = import.meta.env.VITE_LOG_LEVEL?.trim().toLowerCase();
  if (raw && raw in LEVEL_RANK) {
    return raw as LogLevel;
  }
  return "debug";
}

let activeLevel = resolveLogLevel();

function shouldLog(level: LogLevel): boolean {
  return LEVEL_RANK[level] >= LEVEL_RANK[activeLevel];
}

function prefixArgs(args: unknown[]): unknown[] {
  return args.length > 0 && typeof args[0] === "string"
    ? [`[ownly] ${args[0]}`, ...args.slice(1)]
    : ["[ownly]", ...args];
}

export const logger = {
  trace(...args: unknown[]): void {
    if (shouldLog("trace")) {
      console.debug(...prefixArgs(args));
    }
  },
  debug(...args: unknown[]): void {
    if (shouldLog("debug")) {
      console.debug(...prefixArgs(args));
    }
  },
  info(...args: unknown[]): void {
    if (shouldLog("info")) {
      console.info(...prefixArgs(args));
    }
  },
  warn(...args: unknown[]): void {
    if (shouldLog("warn")) {
      console.warn(...prefixArgs(args));
    }
  },
  error(...args: unknown[]): void {
    if (shouldLog("error")) {
      console.error(...prefixArgs(args));
    }
  },
};

// Human: Call once at startup so the effective level is visible in Docker and dev consoles.
// Agent: RE-READS VITE_LOG_LEVEL; EMITS info when level is info or more verbose.
export function initLogger(): void {
  activeLevel = resolveLogLevel();
  if (shouldLog("info")) {
    logger.info("frontend logger ready", { level: activeLevel });
  }
}
