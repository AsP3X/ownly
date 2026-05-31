// Human: Storage Node SSH terminal modal — login-signup.pencil frame zJQeR / ayUn4.
// Agent: RENDERS mock secure shell from AdminStorageNodeRow metrics; NO real SSH; CLOSES via header X.

import { useCallback, useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2, Minus, Terminal, X } from "lucide-react";
import "@fontsource/inconsolata/400.css";
import "@fontsource/inconsolata/700.css";
import type { AdminStorageNodeRow } from "@/api/client";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";

type TerminalLine = {
  id: string;
  text: string;
  color: string;
};

type ConnectionState = "connected" | "offline";

/** Human: Derive shell username from admin email — matches Pencil sarah_chen@node-us-east-14 prompt. */
function terminalUsername(email: string | undefined): string {
  if (!email) return "admin";
  const local = email.split("@")[0] ?? "admin";
  return local.replace(/\./g, "_").toLowerCase();
}

/** Human: Parse "88.4 TB / 120 TB" style labels into utilization percent for console output. */
function capacityUtilPercent(capacityLabel: string): number | null {
  const match = capacityLabel.match(/([\d.]+)\s*(\w+)?\s*\/\s*([\d.]+)/);
  if (!match) return null;
  const used = Number.parseFloat(match[1] ?? "0");
  const cap = Number.parseFloat(match[3] ?? "0");
  if (cap <= 0) return null;
  return Math.round((used / cap) * 1000) / 10;
}

/** Human: Stable pseudo-PID from node id for repeated opens of the same node. */
function pseudoPid(nodeId: string): number {
  let hash = 0;
  for (let i = 0; i < nodeId.length; i += 1) {
    hash = (hash * 31 + nodeId.charCodeAt(i)) >>> 0;
  }
  return 10_000 + (hash % 20_000);
}

/** Human: Format last-login timestamp like the Pencil console line. */
function formatLastLogin(now: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${days[now.getDay()]} ${months[now.getMonth()]} ${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())} ${now.getFullYear()}`;
}

/** Human: Map node probe status to CONNECTED / OFFLINE header badge. */
function connectionState(status: string): ConnectionState {
  if (status === "healthy" || status === "syncing") return "connected";
  return "offline";
}

/** Human: Build boot + ownly-admin-agent status block from live node row data. */
function buildStatusLines(node: AdminStorageNodeRow, username: string): TerminalLine[] {
  const connected = connectionState(node.status) === "connected";
  const util = capacityUtilPercent(node.capacity_label);
  const pid = pseudoPid(node.id);
  const latency = node.latency_ms ?? 0;
  const inboundMbps = Math.max(12, Math.round(220 - latency * 2));
  const outboundMbps = Math.max(8, Math.round(inboundMbps * 0.7));

  const lines: TerminalLine[] = [
    {
      id: "welcome",
      text: "Welcome to Ownly Secure Terminal (v2.13-LTS)",
      color: "#9CA3AF",
    },
    {
      id: "login",
      text: `Last login: ${formatLastLogin(new Date())} from ${node.endpoint_host}`,
      color: "#4B5563",
    },
    {
      id: "cmd",
      text: `${username}@${node.id}:~$ ownly-admin-agent status`,
      color: "#34D399",
    },
    {
      id: "svc-title",
      text: connected
        ? "● ownly-storage-node.service - Ownly Clustered Storage Daemon"
        : "× ownly-storage-node.service - Ownly Clustered Storage Daemon",
      color: connected ? "#10B981" : "#EF4444",
    },
    {
      id: "loaded",
      text: "   Loaded: loaded (/etc/systemd/system/ownly-storage-node.service; enabled; vendor preset: enabled)",
      color: "#D1D5DB",
    },
  ];

  if (connected) {
    lines.push({
      id: "active",
      text: `   Active: active (running) since ${formatLastLogin(new Date(Date.now() - 30 * 60 * 60 * 1000))} UTC; 1 day 6h ago`,
      color: "#34D399",
    });
  } else {
    lines.push({
      id: "active",
      text: "   Active: failed (Result: exit-code) since 2 min ago",
      color: "#EF4444",
    });
  }

  lines.push(
    {
      id: "pid",
      text: `   Main PID: ${pid} (ownly-storage-d)`,
      color: "#D1D5DB",
    },
    {
      id: "tasks",
      text: "   Tasks: 42 (limit: 4915)",
      color: "#D1D5DB",
    },
    {
      id: "memory",
      text: "   Memory: 4.8G (limit: 16.0G)",
      color: "#D1D5DB",
    },
    {
      id: "disk",
      text:
        util != null
          ? `   Disk Space Utilized: ${node.capacity_label} (${util}% allocated)`
          : `   Disk Space Utilized: ${node.capacity_label}`,
      color: util != null && util >= 70 ? "#F59E0B" : "#D1D5DB",
    },
    {
      id: "network",
      text: connected
        ? `   Network Bandwidth: Inbound: ${inboundMbps} MB/s | Outbound: ${outboundMbps} MB/s`
        : `   Network Bandwidth: unreachable (${node.endpoint_host})`,
      color: connected ? "#60A5FA" : "#EF4444",
    },
  );

  return lines;
}

let lineCounter = 0;
function nextLineId(prefix: string): string {
  lineCounter += 1;
  return `${prefix}-${lineCounter}`;
}

/** Human: Monospace console line — Inconsolata 13px per Pencil i6cKja body. */
function ConsoleLine({ line }: { line: TerminalLine }) {
  return (
    <p className="whitespace-pre-wrap break-all font-[Inconsolata] text-[13px] leading-relaxed" style={{ color: line.color }}>
      {line.text}
    </p>
  );
}

/** Human: Interactive terminal session — remounts per open via key for fresh boot output. */
function AdminStorageNodeTerminalSession({
  node,
  onOpenChange,
}: {
  node: AdminStorageNodeRow;
  onOpenChange: (open: boolean) => void;
}) {
  const { user } = useAuth();
  const username = terminalUsername(user?.email);
  const [lines, setLines] = useState<TerminalLine[]>(() => buildStatusLines(node, username));
  const [input, setInput] = useState("");
  const [minimized, setMinimized] = useState(false);
  const [maximized, setMaximized] = useState(false);
  const [tailTimer, setTailTimer] = useState<ReturnType<typeof setInterval> | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const connection = connectionState(node.status);

  const scrollToBottom = useCallback(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [lines, scrollToBottom]);

  useEffect(() => {
    if (!minimized) {
      inputRef.current?.focus();
    }
  }, [minimized]);

  useEffect(() => {
    return () => {
      if (tailTimer) clearInterval(tailTimer);
    };
  }, [tailTimer]);

  function appendLine(text: string, color: string, prefix = "out") {
    setLines((prev) => [...prev, { id: nextLineId(prefix), text, color }]);
  }

  function stopTail() {
    if (tailTimer) {
      clearInterval(tailTimer);
      setTailTimer(null);
    }
  }

  function runCommand(raw: string) {
    const command = raw.trim();
    appendLine(`${username}@${node.id}:~$ ${raw}`, "#34D399", "prompt");

    if (!command) return;

    const lower = command.toLowerCase();

    if (lower === "clear") {
      setLines([]);
      stopTail();
      return;
    }

    if (lower === "exit" || lower === "quit") {
      stopTail();
      onOpenChange(false);
      return;
    }

    if (lower === "help") {
      appendLine("Available commands:", "#9CA3AF");
      appendLine("  ownly-admin-agent status  — show storage daemon status", "#D1D5DB");
      appendLine("  tail -f /var/log/ownly/storage.log — stream storage daemon log", "#D1D5DB");
      appendLine("  clear                     — clear terminal output", "#D1D5DB");
      appendLine("  exit                      — close terminal session", "#D1D5DB");
      return;
    }

    if (lower === "ownly-admin-agent status") {
      setLines((prev) => [...prev, ...buildStatusLines(node, username)]);
      return;
    }

    if (lower === "tail -f /var/log/ownly/storage.log" || lower === "tail -f /var/log/ownly/sync.log") {
      stopTail();
      appendLine("[storage] tailing /var/log/ownly/storage.log (Ctrl+C to stop — type clear)", "#9CA3AF");
      const samples = [
        `[${new Date().toISOString()}] INFO  health ok region=${node.region_label}`,
        `[${new Date().toISOString()}] INFO  checksum verified object shard node=${node.id}`,
        `[${new Date().toISOString()}] INFO  heartbeat ok latency=${node.latency_ms ?? "n/a"}ms`,
      ];
      let idx = 0;
      const timer = setInterval(() => {
        appendLine(samples[idx % samples.length] ?? "", "#D1D5DB", "tail");
        idx += 1;
      }, 1800);
      setTailTimer(timer);
      return;
    }

    appendLine(`${command}: command not found`, "#EF4444");
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter") {
      event.preventDefault();
      runCommand(input);
      setInput("");
    }
  }

  return (
    <DialogContent
      showCloseButton={false}
      overlayClassName="bg-black/30"
      className={cn(
        "flex flex-col gap-0 overflow-hidden border border-[#1F2937] bg-[#111827] p-0 shadow-[0_16px_32px_-4px_#00000040] sm:max-w-[900px]",
        maximized
          ? "h-[calc(100vh-48px)] max-h-[calc(100vh-48px)] w-[calc(100vw-48px)] max-w-[calc(100vw-48px)]"
          : minimized
            ? "h-auto max-h-none"
            : "h-[640px] max-h-[90vh] w-full max-w-[900px]",
      )}
      onClick={() => inputRef.current?.focus()}
    >
      <DialogTitle className="sr-only">SSH Terminal: {node.id}</DialogTitle>
      <DialogDescription className="sr-only">
        Secure admin terminal session for storage node {node.id}
      </DialogDescription>

      {/* Human: Terminal header — 48px #1E1E1E bar per Pencil v3qzM frame. */}
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-[#27272A] bg-[#1E1E1E] px-4">
        <div className="flex min-w-0 items-center gap-3">
          <Terminal className="size-3.5 shrink-0 text-[#2563EB]" aria-hidden />
          <span className="truncate font-[Inconsolata] text-[13px] font-bold text-white">
            SSH Terminal: {node.id}
          </span>
          <span
            className={cn(
              "shrink-0 rounded px-1.5 py-0.5 font-[Inconsolata] text-[10px] font-bold",
              connection === "connected" ? "bg-[#065F46] text-[#34D399]" : "bg-[#7F1D1D] text-[#FCA5A5]",
            )}
          >
            {connection === "connected" ? "CONNECTED" : "OFFLINE"}
          </span>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setMinimized((v) => !v)}
            className="text-[#888888] transition-colors hover:text-[#D1D5DB]"
            aria-label={minimized ? "Restore terminal" : "Minimize terminal"}
          >
            <Minus className="size-4" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => {
              setMaximized((v) => !v);
              setMinimized(false);
            }}
            className="text-[#888888] transition-colors hover:text-[#D1D5DB]"
            aria-label={maximized ? "Restore terminal size" : "Maximize terminal"}
          >
            {maximized ? <Minimize2 className="size-3.5" aria-hidden /> : <Maximize2 className="size-3.5" aria-hidden />}
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="flex size-6 items-center justify-center text-[#888888] transition-colors hover:text-[#D1D5DB]"
            aria-label="Close terminal"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      </header>

      {!minimized ? (
        <>
          {/* Human: Scrollable console body — #0B0F19 fill per Pencil i6cKja. */}
          <div
            ref={bodyRef}
            className="flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto bg-[#0B0F19] p-6"
          >
            {lines.map((line) => (
              <ConsoleLine key={line.id} line={line} />
            ))}

            {/* Human: Active prompt row with blinking cursor per Pencil M0KTl frame. */}
            <div className="flex flex-wrap items-center font-[Inconsolata] text-[13px]">
              <span className="text-[#34D399]">{`${username}@${node.id}:~$ `}</span>
              <span className="text-white">{input}</span>
              <span
                className="ml-0.5 inline-block h-[15px] w-2 animate-pulse bg-[#34D399]"
                aria-hidden
              />
            </div>
          </div>

          {/* Agent: Hidden input captures keyboard; visible prompt mirrors typed text above. */}
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            className="sr-only"
            aria-label="Terminal command input"
            autoComplete="off"
            spellCheck={false}
          />
        </>
      ) : null}
    </DialogContent>
  );
}

/** Human: Storage node SSH terminal — dark modal with interactive prompt row. */
export function AdminStorageNodeTerminalDialog({
  open,
  onOpenChange,
  node,
  sessionKey,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  node: AdminStorageNodeRow | null;
  sessionKey: number;
}) {
  if (!node) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <AdminStorageNodeTerminalSession
        key={`${node.id}-${sessionKey}`}
        node={node}
        onOpenChange={onOpenChange}
      />
    </Dialog>
  );
}
