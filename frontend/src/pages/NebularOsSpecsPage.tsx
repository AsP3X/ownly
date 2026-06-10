// Human: Public Nebular-OS technical specs page from Pencil Ownly Public Nebular-OS Specs Page.
// Agent: RENDERED at `/specs/nebular-os`; static architecture documentation; no API calls.

import {
  ArrowRight,
  Database,
  HardDrive,
  KeyRound,
  Shield,
  Zap,
} from "lucide-react";
import { MarketingHeroSection } from "@/components/marketing/MarketingHeroSection";
import { MarketingPageShell } from "@/components/marketing/MarketingPageShell";
import {
  NEBULAR_INTEGRITY_ROWS,
  NEBULAR_ON_DISK_FORMAT_ROWS,
  NEBULAR_ZSTD_PHASE_ROWS,
} from "@/lib/nebular-storage-docs";

const heroHighlights = [
  { icon: Database, label: "SQLite WAL Metadata", detail: "Atomic bucket/key storage in Write-Ahead Log mode." },
  { icon: HardDrive, label: "Flat-File Disk Blobs", detail: "No file system overhead, direct content-addressable storage." },
  {
    icon: Zap,
    label: "Tiered zstd (NOSI)",
    detail: "Fast upload level (default 3) plus background recompress to level 22 with indexed blocks.",
  },
  { icon: KeyRound, label: "JWT & HMAC Security", detail: "Stateless security gates and S3-compatible credentials." },
];

const securityGates = [
  {
    title: "Authorization JWT Secrets",
    description:
      "Decodes and verifies standard JWTs against asymmetric public keys or shared HMAC secrets, enforcing fine-grained user read/write scopes.",
  },
  {
    title: "Presigned URLs (HMAC)",
    description:
      "Generates time-locked secure download links with HMAC-SHA256 hashes, allowing temporary file sharing without authentication headers.",
  },
  {
    title: "S3-Style Access Keys",
    description:
      "Authenticates client SDKs via AWS Signature Version 4 compatible headers using structured Access Key ID and Secret Access Key pairs.",
  },
  {
    title: "Rate Limiting & Bypass",
    description:
      "Applies Token-Bucket rate limiters globally or per-route, with configurable bypass rules allowing public access to designated assets.",
  },
];

export default function NebularOsSpecsPage() {
  return (
    <MarketingPageShell>
      <MarketingHeroSection
        badgeIcon={Shield}
        badgeLabel="NEBULAR-OS SPECIFICATION"
        title="Nebular-OS Architecture & Core Internals"
        subtitle="A highly optimized, self-hosted object storage engine combining ultra-fast SQLite transactional metadata with direct flat-file disk blobs. Designed for low latency, zero overhead, and effortless scaling."
      />

      {/* Human: Four highlight tiles from Pencil Hero Highlights Grid */}
      <section className="grid w-full gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {heroHighlights.map((item) => {
          const Icon = item.icon;
          return (
            <article
              key={item.label}
              className="flex flex-col gap-2 rounded-xl border border-[#E5E7EB] bg-white p-5"
            >
              <Icon className="size-5 text-[#2563EB]" aria-hidden />
              <h2 className="text-sm font-bold text-[#1A1A1A]">{item.label}</h2>
              <p className="text-xs leading-relaxed text-[#666666]">{item.detail}</p>
            </article>
          );
        })}
      </section>

      {/* Human: Section 1 — two-layer storage from Pencil Section 1: Two-Layer Storage */}
      <section className="flex w-full flex-col gap-6 py-8">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold text-[#2563EB]">01 — STORAGE LAYER ENGINE</span>
          <h2 className="text-2xl font-bold text-[#1A1A1A]">Decoupled Two-Layer Storage Engine</h2>
          <p className="max-w-3xl text-sm leading-relaxed text-[#666666]">
            Nebular-OS divides responsibility strictly: lightweight SQLite stores queryable metadata while raw binary
            blobs sit directly on the host filesystem. This separation keeps lookups fast and payloads massive.
          </p>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <article className="rounded-2xl border border-[#E5E7EB] bg-[#F7F8FA] p-8">
            <h3 className="text-lg font-bold text-[#1A1A1A]">Metadata Layer (SQLite 3)</h3>
            <p className="mt-2 text-sm text-[#666666]">
              Bucket keys, ETags, compression flags, and content digests in WAL mode for atomic upserts.
            </p>
          </article>
          <article className="rounded-2xl border border-[#E5E7EB] bg-[#F7F8FA] p-8">
            <h3 className="text-lg font-bold text-[#1A1A1A]">Blob Storage Layer (POSIX)</h3>
            <p className="mt-2 text-sm text-[#666666]">
              Flat files on disk with no database overhead — direct streaming reads and writes.
            </p>
          </article>
        </div>
      </section>

      {/* Human: Section 2 — xxHash3 path resolution from Pencil Section 2: Blob Layout Spreading */}
      <section className="flex w-full flex-col gap-6 py-8">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold text-[#2563EB]">02 — ON-DISK BLOB LAYOUT</span>
          <h2 className="text-2xl font-bold text-[#1A1A1A]">xxHash3 Prefix-Based Folder Spreading</h2>
          <p className="max-w-3xl text-sm leading-relaxed text-[#666666]">
            To avoid filesystem performance degradation with large directories, Nebular-OS implements an elegant
            xxHash3-based folder sharding structure.
          </p>
        </div>
        <div className="rounded-2xl border border-[#E5E7EB] bg-[#F7F8FA] p-8">
          <p className="mb-6 text-xs font-bold tracking-wide text-[#666666]">PATH RESOLUTION FLOW</p>
          <div className="flex flex-col items-center gap-4 sm:flex-row sm:flex-wrap sm:justify-center">
            {[
              { step: "1. Payload Input", value: "image.png (3.4 MB)" },
              { step: "2. xxHash3 (128-bit)", value: "e8a10fd34b92c5f1" },
              { step: "3. Prefix Sharding", value: "e8/ → a1/" },
              { step: "4. Final Storage Path", value: "data/blobs/e8/a1/e8a10fd34b92c5f1" },
            ].map((item, index) => (
              <div key={item.step} className="flex items-center gap-4">
                <div className="flex flex-col gap-1 rounded-lg border border-[#E5E7EB] bg-white px-4 py-3 text-center">
                  <span className="text-[10px] font-bold text-[#2563EB]">{item.step}</span>
                  <span className="font-mono text-xs text-[#1A1A1A]">{item.value}</span>
                </div>
                {index < 3 ? <ArrowRight className="hidden size-4 text-[#888888] sm:block" aria-hidden /> : null}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Human: Section 3 — PUT/GET pipelines from Pencil Section 3: Request Paths */}
      <section className="flex w-full flex-col gap-6 py-8">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold text-[#2563EB]">03 — HTTP PIPELINE FLOWS</span>
          <h2 className="text-2xl font-bold text-[#1A1A1A]">End-to-End PUT and GET Request Paths</h2>
          <p className="max-w-3xl text-sm leading-relaxed text-[#666666]">
            Nebular-OS is built for high concurrency. Request pipelines are structured as non-blocking async streams
            that optimize system call density.
          </p>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          <article className="rounded-2xl border border-[#E5E7EB] bg-white p-6">
            <h3 className="mb-4 text-base font-bold text-[#1A1A1A]">Write Path: PUT /bucket/key</h3>
            <ol className="flex flex-col gap-3 text-sm text-[#666666]">
              <li>
                <strong className="text-[#1A1A1A]">1. Temp Streaming</strong> — Incoming body streamed to
                data/tmp/[uuid].tmp.
              </li>
              <li>
                <strong className="text-[#1A1A1A]">2. Hash &amp; Compress</strong> — xxHash3 ETag + zstd compressor
                stream.
              </li>
              <li>
                <strong className="text-[#1A1A1A]">3. FS Atomic Move</strong> — rename() to hashed destination.
              </li>
              <li>
                <strong className="text-[#1A1A1A]">4. SQLite Metadata Upsert</strong> — WAL transaction completes
                with instant fsync.
              </li>
            </ol>
          </article>
          <article className="rounded-2xl border border-[#E5E7EB] bg-white p-6">
            <h3 className="mb-4 text-base font-bold text-[#1A1A1A]">Read Path: GET /bucket/key</h3>
            <ol className="flex flex-col gap-3 text-sm text-[#666666]">
              <li>
                <strong className="text-[#1A1A1A]">1. DB Lookup</strong> — Fetch size, compression status, digest.
              </li>
              <li>
                <strong className="text-[#1A1A1A]">2. Path Resolve</strong> — Format path from xxHash3 prefix.
              </li>
              <li>
                <strong className="text-[#1A1A1A]">3. Direct Stream / Decompress</strong> — On-the-fly zstd decode.
              </li>
              <li>
                <strong className="text-[#1A1A1A]">4. ETag Validation</strong> — Content-Length, Content-Type,
                Cache-Control headers.
              </li>
            </ol>
          </article>
        </div>
      </section>

      {/* Human: Section 4 — NOS2/NOSZ compression (aligned with Nebular changelog, not size-tier fiction) */}
      <section className="flex w-full flex-col gap-6 py-8">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold text-[#2563EB]">04 — TRANSPARENT COMPRESSION</span>
          <h2 className="text-2xl font-bold text-[#1A1A1A]">NOSI indexed block compression</h2>
          <p className="max-w-3xl text-sm leading-relaxed text-[#666666]">
            New blobs use the NOSI header (logical size, block index, optional dictionary id, per-block checksums).
            Legacy NOSB, NOSZ, and NOS2 remain readable. Background recompression migrates them to NOSI and upgrades
            low-level blobs when a stronger pass saves space.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {NEBULAR_ON_DISK_FORMAT_ROWS.map((fmt) => (
            <div key={fmt.magic} className="rounded-lg border border-[#E5E7EB] bg-[#F7F8FA] p-4">
              <span className="font-mono text-sm font-bold text-[#2563EB]">{fmt.magic}</span>
              <p className="mt-1 text-xs text-[#666666]">{fmt.detail}</p>
            </div>
          ))}
        </div>

        <div className="overflow-hidden rounded-xl border border-[#E5E7EB]">
          <div className="grid grid-cols-3 gap-px bg-[#E5E7EB] text-xs font-bold text-[#666666]">
            <div className="bg-[#F7F8FA] px-4 py-2.5">Phase</div>
            <div className="bg-[#F7F8FA] px-4 py-2.5">Environment</div>
            <div className="bg-[#F7F8FA] px-4 py-2.5">Default</div>
          </div>
          {NEBULAR_ZSTD_PHASE_ROWS.map((row) => (
            <div key={row.phase} className="grid grid-cols-3 gap-px bg-[#E5E7EB] text-sm">
              <div className="bg-white px-4 py-3 text-xs text-[#1A1A1A]">{row.phase}</div>
              <div className="bg-white px-4 py-3 font-mono text-[10px] text-[#666666]">{row.env}</div>
              <div className="bg-white px-4 py-3 text-xs text-[#666666]">
                {row.level} — {row.note}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Human: Section 4b — integrity scrub, verify-on-read, webhooks (Nebular 1e94546+). */}
      {/* Agent: Static docs only; env keys match docker-compose.yml and docs/storage-disk-tuning.md. */}
      <section className="flex w-full flex-col gap-6 py-8">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold text-[#2563EB]">04b — INTEGRITY &amp; EVENTS</span>
          <h2 className="text-2xl font-bold text-[#1A1A1A]">Scrub sampling, verify-on-read, and webhooks</h2>
          <p className="max-w-3xl text-sm leading-relaxed text-[#666666]">
            Periodic scrub walks a hash-sampled subset of keys with a rotating cursor. Admin{" "}
            <code className="rounded bg-[#F7F8FA] px-1 py-0.5 font-mono text-xs">POST /_nos/maintenance/verify_blobs</code>{" "}
            accepts mode and sample overrides. Dead-letter replication events can be replayed via{" "}
            <code className="rounded bg-[#F7F8FA] px-1 py-0.5 font-mono text-xs">POST /_nos/maintenance/replication_replay</code>.
          </p>
        </div>
        <div className="overflow-hidden rounded-xl border border-[#E5E7EB]">
          <div className="grid grid-cols-3 gap-px bg-[#E5E7EB] text-xs font-bold text-[#666666]">
            <div className="bg-[#F7F8FA] px-4 py-2.5">Environment</div>
            <div className="bg-[#F7F8FA] px-4 py-2.5">Default</div>
            <div className="bg-[#F7F8FA] px-4 py-2.5">Purpose</div>
          </div>
          {NEBULAR_INTEGRITY_ROWS.map((row) => (
            <div key={row.env} className="grid grid-cols-3 gap-px bg-[#E5E7EB] text-sm">
              <div className="bg-white px-4 py-3 font-mono text-[10px] text-[#666666]">{row.env}</div>
              <div className="bg-white px-4 py-3 text-xs text-[#1A1A1A]">{row.default}</div>
              <div className="bg-white px-4 py-3 text-xs text-[#666666]">{row.note}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Human: Section 5 — security gates from Pencil Section 5: Security Gates */}
      <section className="flex w-full flex-col gap-6 py-8">
        <div className="flex flex-col gap-2">
          <span className="text-xs font-bold text-[#2563EB]">05 — SECURITY &amp; ACCESS CONTROL</span>
          <h2 className="text-2xl font-bold text-[#1A1A1A]">Multi-Tier HTTP Security Gates</h2>
          <p className="max-w-3xl text-sm leading-relaxed text-[#666666]">
            Nebular-OS enforces a strict stateless authentication mesh. Every inbound request traverses standard
            gateway filters to guarantee payload integrity.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {securityGates.map((gate) => (
            <article key={gate.title} className="rounded-xl border border-[#E5E7EB] bg-white p-6">
              <h3 className="text-base font-bold text-[#1A1A1A]">{gate.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-[#666666]">{gate.description}</p>
            </article>
          ))}
        </div>
      </section>
    </MarketingPageShell>
  );
}
