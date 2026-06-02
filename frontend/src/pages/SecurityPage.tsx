// Human: Public Security page — security pillars and Nebular-OS comparison from Pencil Ownly Public Security Page.
// Agent: RENDERED at `/security`; static marketing content; LINKS CTA to /register.

import { Check, Code, Database, Key, ShieldCheck, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { MarketingCtaSection } from "@/components/marketing/MarketingCtaSection";
import { MarketingHeroSection } from "@/components/marketing/MarketingHeroSection";
import { MarketingPageShell } from "@/components/marketing/MarketingPageShell";
import { SYMMETRIC_CIPHER } from "@/lib/encryption-standards";

type SecurityPillar = {
  title: string;
  subtitle: string;
  description: string;
  icon: LucideIcon;
  specs: { label: string; value: string }[];
};

const securityPillars: SecurityPillar[] = [
  {
    title: "AES-256-GCM at rest",
    subtitle: "Quantum-hardened symmetric encryption",
    description:
      "Content keys and sensitive metadata are protected with AES-256-GCM envelope encryption. Grover's algorithm only reduces AES-256 to roughly 2^128 operations — still infeasible to break.",
    icon: ShieldCheck,
    specs: [
      { label: "Symmetric cipher", value: SYMMETRIC_CIPHER },
      { label: "Key wrapping", value: "Per-file envelope" },
    ],
  },
  {
    title: "Hybrid post-quantum TLS",
    subtitle: "Protect keys in transit",
    description:
      "Classical RSA/ECC alone is vulnerable to Shor's algorithm. Terminate HTTPS with hybrid key exchange that pairs ML-KEM (NIST PQC) with classical ECDHE/RSA at your edge proxy.",
    icon: Key,
    specs: [
      { label: "Recommended", value: "ML-KEM + ECDHE" },
      { label: "Threat model", value: "Harvest-now, decrypt-later" },
    ],
  },
  {
    title: "Credential hardening",
    subtitle: "Passwords never stored raw",
    description:
      "User passwords are hashed with Argon2id. Session JWTs gate API access; stream tickets gate time-limited media segment delivery without exposing long-lived secrets.",
    icon: Database,
    specs: [
      { label: "Password KDF", value: "Argon2id" },
      { label: "Sessions", value: "HS256 JWT" },
    ],
  },
  {
    title: "Auditable cryptography",
    subtitle: "Transparent architecture",
    description:
      "Encryption standards are documented in the admin console and public specs. HLS streaming uses AES-128-CBC segments for player compatibility while segment keys remain wrapped with AES-256-GCM.",
    icon: Code,
    specs: [
      { label: "Edge key exchange", value: "Hybrid PQC TLS" },
      { label: "Password KDF", value: "Argon2id" },
    ],
  },
];

const ownlyComparison = [
  {
    title: "Automated Blob Conversion",
    description: "Files are parsed and converted into binary blobs for ultra-fast chunks processing.",
  },
  {
    title: "High-Ratio Compression",
    description:
      "Drive uploads are zstd-compressed in Nebular OS (fast upload level, optional background upgrade). HLS segments are encrypted separately and rarely shrink under zstd.",
  },
  {
    title: "AES-256 envelope encryption",
    description:
      "Per-file content keys are wrapped with AES-256-GCM in Postgres; HLS segment keys use AES-128-CBC for player compatibility. Plaintext keys never persist on disk.",
  },
  {
    title: "Multi-Zone Redundancy",
    description: "Replicated across independent storage pools with 99.999% mathematical durability.",
  },
];

const legacyComparison = [
  {
    title: "Raw Uncompressed Files",
    description: "Files stored as raw, massive files, leading to slow transfer times and heavy bandwidth waste.",
  },
  {
    title: "No Compression Engine",
    description: "No server-side file stream compression, resulting in slow loading and high latency during retrieval.",
  },
  {
    title: "Fragmented Security",
    description: "Static file-level security without automated chunk-based storage-level encryption.",
  },
  {
    title: "Single Point of Failure",
    description: "Rely on single centralized disk partitions with prone downtime and slow failovers.",
  },
];

export default function SecurityPage() {
  return (
    <MarketingPageShell>
      <MarketingHeroSection
        badgeIcon={ShieldCheck}
        badgeLabel="NEBULAR-OS OBJECT STORAGE"
        title="Enterprise-grade storage. Advanced blob optimization."
        subtitle="Ownly is built on the secure, high-durability nebular-os architecture. Your files are safely ingested, compressed, and encrypted at rest across robust cloud pools."
      />

      {/* Human: 2×2 security pillar cards from Pencil Security Pillars Showcase Container */}
      <section className="grid w-full gap-6 lg:grid-cols-2">
        {securityPillars.map((pillar) => {
          const Icon = pillar.icon;
          return (
            <article
              key={pillar.title}
              className="flex flex-col gap-5 rounded-xl border border-[#E5E7EB] bg-white p-6 shadow-[0_4px_12px_#00000008]"
            >
              <div className="flex items-start gap-4">
                <div className="flex size-12 shrink-0 items-center justify-center rounded-lg bg-[#EFF6FF]">
                  <Icon className="size-6 text-[#2563EB]" aria-hidden />
                </div>
                <div className="flex flex-col gap-1">
                  <h2 className="text-lg font-semibold text-[#1A1A1A]">{pillar.title}</h2>
                  <span className="text-xs font-medium text-[#2563EB]">{pillar.subtitle}</span>
                </div>
              </div>
              <p className="text-sm leading-relaxed text-[#666666]">{pillar.description}</p>
              <dl className="flex flex-col gap-2 rounded-lg bg-[#F7F8FA] px-4 py-3">
                {pillar.specs.map((spec) => (
                  <div key={spec.label} className="flex items-center justify-between text-xs">
                    <dt className="text-[#666666]">{spec.label}</dt>
                    <dd className="font-semibold text-[#1A1A1A]">{spec.value}</dd>
                  </div>
                ))}
              </dl>
            </article>
          );
        })}
      </section>

      {/* Human: Ownly vs legacy comparison columns from Pencil Security Comparison Section */}
      <section className="flex w-full flex-col items-center gap-10 rounded-2xl bg-[#F7F8FA] px-6 py-16 sm:px-12 lg:px-16">
        <div className="flex max-w-3xl flex-col items-center gap-3 text-center">
          <h2 className="text-3xl font-bold text-[#1A1A1A]">
            Why Nebular Object Storage is Non-Negotiable
          </h2>
          <p className="text-[15px] leading-relaxed text-[#666666]">
            Compare the performance and structural guarantees of Ownly&apos;s Nebular-OS against traditional cloud
            providers.
          </p>
        </div>

        <div className="grid w-full gap-8 lg:grid-cols-2">
          <article className="flex flex-col gap-6 rounded-xl border-2 border-[#2563EB] bg-white p-8 shadow-[0_8px_16px_#0000000A]">
            <div className="flex items-start justify-between">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-bold text-[#2563EB]">NEBULAR-OS BLOB PERFORMANCE</span>
                <h3 className="text-xl font-bold text-[#1A1A1A]">Ownly (Powered by Nebular-OS)</h3>
              </div>
              <ShieldCheck className="size-7 text-[#2563EB]" aria-hidden />
            </div>
            <ul className="flex flex-col gap-5">
              {ownlyComparison.map((item) => (
                <li key={item.title} className="flex gap-3">
                  <Check className="mt-0.5 size-[18px] shrink-0 text-[#10B981]" aria-hidden />
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-semibold text-[#1A1A1A]">{item.title}</span>
                    <span className="text-sm text-[#666666]">{item.description}</span>
                  </div>
                </li>
              ))}
            </ul>
          </article>

          <article className="flex flex-col gap-6 rounded-xl border border-[#E5E7EB] bg-white p-8">
            <div className="flex items-start justify-between">
              <div className="flex flex-col gap-1">
                <span className="text-[11px] font-bold text-[#888888]">TRADITIONAL RAW FILE STORAGE</span>
                <h3 className="text-xl font-bold text-[#1A1A1A]">Legacy Cloud Storage</h3>
              </div>
              <X className="size-7 text-[#888888]" aria-hidden />
            </div>
            <ul className="flex flex-col gap-5">
              {legacyComparison.map((item) => (
                <li key={item.title} className="flex gap-3">
                  <X className="mt-0.5 size-[18px] shrink-0 text-[#EF4444]" aria-hidden />
                  <div className="flex flex-col gap-1">
                    <span className="text-sm font-semibold text-[#1A1A1A]">{item.title}</span>
                    <span className="text-sm text-[#666666]">{item.description}</span>
                  </div>
                </li>
              ))}
            </ul>
          </article>
        </div>
      </section>

      <MarketingCtaSection
        title="Uncompromising security awaits."
        subtitle="Join security-conscious individuals and elite teams who trust Ownly with their sensitive data."
      />
    </MarketingPageShell>
  );
}
