// Human: Public cryptographic & storage architecture specs from Pencil Ownly Public Cryptographic Specs Page.
// Agent: RENDERED at `/specs/storage`; static technical documentation; LINKS CTA to /register.

import { Check, Cloud, Cpu, Database, Key, ShieldCheck } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { MarketingCtaSection } from "@/components/marketing/MarketingCtaSection";
import { MarketingHeroSection } from "@/components/marketing/MarketingHeroSection";
import { MarketingPageShell } from "@/components/marketing/MarketingPageShell";
import {
  BLOB_STORAGE_PLAINTEXT_TO_NEBULAR,
  KEY_EXCHANGE,
  KEY_WRAPPING,
  QUANTUM_READINESS_CHECKLIST,
  QUANTUM_RESISTANCE_PILLARS,
  STREAMING_SEGMENT_CIPHER,
  SYMMETRIC_CIPHER,
} from "@/lib/encryption-standards";
import {
  NEBULAR_ON_DISK_FORMAT_ROWS,
  NEBULAR_ZSTD_PHASE_ROWS,
  OWNLY_FOLDER_ZIP_NOTE,
  OWNLY_STORAGE_ENCRYPTION_SUMMARY,
} from "@/lib/nebular-storage-docs";

type StorageCard = {
  title: string;
  subtitle: string;
  description: string;
  icon: LucideIcon;
  items: string[];
};

const storageCards: StorageCard[] = [
  {
    title: "PostgreSQL Metadata Layer",
    subtitle: "Relational access control & audit",
    description:
      "Ownly's primary relational system handles access control, session JWT validation, background job tracking, audit trails, folder structures, and key material wrapper mappings.",
    icon: Database,
    items: [
      "User credentials & sessions",
      "Vault folder structure",
      "Audit logs",
      "HLS key store",
    ],
  },
  {
    title: "Nebular OS Blob Layer",
    subtitle: "Flat-file binary storage",
    description:
      "Binary files are written to Nebular OS using predictable prefixes. Flat files on disk use spreading directory structures with xxHash3 key hashing logic.",
    icon: Cloud,
    items: [
      "Predictable content keys",
      "xxHash3 prefix spread",
      "NOSI indexed block blobs",
      "HLS sidecars (encrypted segments)",
    ],
  },
];

const cryptoSteps = [
  {
    step: "STEP 1",
    icon: Cpu,
    title: "Drive uploads → Nebular zstd",
    description: BLOB_STORAGE_PLAINTEXT_TO_NEBULAR,
  },
  {
    step: "STEP 2",
    icon: ShieldCheck,
    title: "AES-256 envelope encryption",
    description: KEY_WRAPPING,
  },
  {
    step: "STEP 3",
    icon: Key,
    title: "Segment encryption (HLS only)",
    description: STREAMING_SEGMENT_CIPHER,
  },
  {
    step: "STEP 4",
    icon: Cloud,
    title: "Hybrid PQC key exchange",
    description: KEY_EXCHANGE,
  },
];

export default function StorageSpecsPage() {
  return (
    <MarketingPageShell>
      <MarketingHeroSection
        badgeLabel="OWNLY STORAGE CORE"
        title="Ownly Cryptographic & Storage Architecture"
        subtitle="Technical specification of how file metadata, AES-256-GCM envelope keys, hybrid post-quantum TLS, and binary blobs are managed across Postgres and Nebular OS."
      />

      {/* Human: Two-column hybrid storage from Pencil Two-Layer Storage Section */}
      <section className="flex w-full flex-col gap-10">
        <div className="flex flex-col items-center gap-2 text-center">
          <h2 className="text-3xl font-bold text-[#1A1A1A]">Two-Layer Hybrid Storage Slices</h2>
          <p className="max-w-2xl text-base text-[#666666]">
            Ownly separates structured relational metadata from raw binary file bytes, achieving fast queries and
            massive scalability. Symmetric protection uses {SYMMETRIC_CIPHER}; keys in transit should use hybrid PQC TLS
            at your edge.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          {storageCards.map((card) => {
            const Icon = card.icon;
            return (
              <article
                key={card.title}
                className="flex flex-col gap-6 rounded-2xl border border-[#E5E7EB] bg-white p-8"
              >
                <div className="flex items-start gap-4">
                  <div className="flex size-11 items-center justify-center rounded-lg bg-[#EEF2F6]">
                    <Icon className="size-5 text-[#2563EB]" aria-hidden />
                  </div>
                  <div className="flex flex-col gap-0.5">
                    <h3 className="text-lg font-bold text-[#1A1A1A]">{card.title}</h3>
                    <span className="text-xs font-semibold text-[#2563EB]">{card.subtitle}</span>
                  </div>
                </div>
                <p className="text-sm leading-relaxed text-[#666666]">{card.description}</p>
                <ul className="flex flex-col gap-3">
                  {card.items.map((item) => (
                    <li key={item} className="flex items-center gap-3 text-sm text-[#666666]">
                      <Check className="size-4 shrink-0 text-[#2563EB]" aria-hidden />
                      {item}
                    </li>
                  ))}
                </ul>
              </article>
            );
          })}
        </div>
      </section>

      {/* Human: Four-step ingest + hybrid PQC posture from cryptographic specs */}
      <section className="flex w-full flex-col gap-10">
        <div className="flex flex-col items-center gap-2 text-center">
          <h2 className="text-3xl font-bold text-[#1A1A1A]">Upload Pipeline &amp; Quantum-Ready Encryption</h2>
          <p className="max-w-2xl text-base text-[#666666]">
            Plaintext content keys never persist on disk. AES-256-GCM wraps keys at rest; hybrid ML-KEM TLS protects key
            exchange in transit.
          </p>
        </div>

        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {cryptoSteps.map((step) => {
            const StepIcon = step.icon;
            return (
              <article
                key={step.step}
                className="flex flex-col gap-4 rounded-xl border border-[#E5E7EB] bg-white p-6"
              >
                <div className="flex items-center justify-between">
                  <span className="rounded-lg bg-[#F7F8FA] px-2 py-1 text-[11px] font-bold text-[#2563EB]">
                    {step.step}
                  </span>
                  <StepIcon className="size-5 text-[#666666]" aria-hidden />
                </div>
                <h3 className="text-lg font-bold text-[#1A1A1A]">{step.title}</h3>
                <p className="text-[13px] leading-relaxed text-[#666666]">{step.description}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section className="flex w-full flex-col gap-8 rounded-2xl border border-[#E5E7EB] bg-[#F7F8FA] px-6 py-10 sm:px-10">
        <div className="flex flex-col gap-2 text-center">
          <h2 className="text-2xl font-bold text-[#1A1A1A]">Two pillars of quantum-resistant encryption</h2>
          <p className="mx-auto max-w-2xl text-sm text-[#666666]">
            True quantum-safe protection requires both strong symmetric ciphers and post-quantum key exchange.
          </p>
        </div>
        <div className="grid gap-6 lg:grid-cols-2">
          {QUANTUM_RESISTANCE_PILLARS.map((pillar) => (
            <article key={pillar.title} className="rounded-xl border border-[#E5E7EB] bg-white p-6">
              <h3 className="text-lg font-semibold text-[#1A1A1A]">{pillar.title}</h3>
              <p className="mt-3 text-sm leading-relaxed text-[#666666]">{pillar.body}</p>
            </article>
          ))}
        </div>
        <ul className="mx-auto flex max-w-2xl flex-col gap-2 text-sm text-[#666666]">
          {QUANTUM_READINESS_CHECKLIST.map((item) => (
            <li key={item} className="flex gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-[#2563EB]" aria-hidden />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Human: Auth gates + compression table from Pencil Auth & Compression Section */}
      <section className="flex w-full flex-col gap-10">
        <div className="flex flex-col items-center gap-2 text-center">
          <h2 className="text-3xl font-bold text-[#1A1A1A]">Access Control &amp; Transparent Optimization</h2>
          <p className="max-w-2xl text-base text-[#666666]">
            How users authenticate session keys, and how Nebular OS transparently compresses storage blocks to maximize
            space.
          </p>
        </div>

        <div className="grid gap-6 lg:grid-cols-2">
          <article className="flex flex-col gap-6 rounded-2xl border border-[#E5E7EB] bg-white p-8">
            <div className="flex flex-col gap-1">
              <h3 className="text-lg font-bold text-[#1A1A1A]">Unified Authentication Architecture</h3>
              <span className="text-xs font-semibold text-[#2563EB]">Argon2, HS256 JWT, and HMAC Presign Queries</span>
            </div>
            <p className="text-sm leading-relaxed text-[#666666]">
              User passwords are secure-hashed via Argon2. Sessions use HS256 JWT tokens with client keys held in the
              iOS secure Keychain. Temporary, anonymous file downloads are generated via signature-verified HMAC URLs.
            </p>
            <div className="rounded-lg border border-[#DCFCE7] bg-[#F0FDF4] p-4">
              <p className="text-[11px] font-bold text-[#166534]">IOS CLIENT PROTECTION</p>
              <p className="mt-1 text-xs leading-relaxed text-[#15803D]">
                Our iOS clients never cache credentials in unsecure UserDefaults. Session tokens are strictly persisted
                inside OS Keychain compartments.
              </p>
            </div>
          </article>

          <article className="flex flex-col gap-5 rounded-2xl border border-[#E5E7EB] bg-white p-8">
            <div className="flex flex-col gap-1">
              <h3 className="text-lg font-bold text-[#1A1A1A]">Nebular NOSI indexed compression</h3>
              <span className="text-xs font-semibold text-[#2563EB]">Compose: NOS_ZSTD_LEVEL_UPLOAD / NOS_ZSTD_LEVEL</span>
            </div>
            <p className="text-sm leading-relaxed text-[#666666]">{OWNLY_STORAGE_ENCRYPTION_SUMMARY}</p>
            <div className="overflow-hidden rounded-xl border border-[#E5E7EB]">
              <div className="grid grid-cols-3 gap-px bg-[#E5E7EB] text-xs font-bold text-[#666666]">
                <div className="bg-[#F7F8FA] px-4 py-2.5">Phase</div>
                <div className="bg-[#F7F8FA] px-4 py-2.5">Env</div>
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
            <p className="text-xs leading-relaxed text-[#666666]">{OWNLY_FOLDER_ZIP_NOTE}</p>
            <div className="flex flex-wrap gap-2">
              {NEBULAR_ON_DISK_FORMAT_ROWS.map((fmt) => (
                <span
                  key={fmt.magic}
                  className="rounded-md border border-[#E5E7EB] bg-[#F7F8FA] px-2 py-1 font-mono text-[10px] text-[#666666]"
                  title={fmt.detail}
                >
                  {fmt.magic}
                </span>
              ))}
            </div>
          </article>
        </div>
      </section>

      <MarketingCtaSection
        title="Secure. Auditable. High Performance."
        subtitle="Join security-focused teams and builders who trust Ownly's dual-layer hybrid storage architecture."
        buttonLabel="Start Free Trial"
      />
    </MarketingPageShell>
  );
}
