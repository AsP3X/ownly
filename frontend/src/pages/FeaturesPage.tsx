// Human: Public Features page — showcase grid and Nebular-OS deep dive from Pencil Ownly Public Features Page.
// Agent: RENDERED at `/features`; static marketing content; LINKS CTA to /register.

import {
  ArrowDown,
  ArrowRight,
  Cloud,
  Cpu,
  Database,
  FileText,
  Globe,
  Key,
  Lock,
  Search,
  Share2,
  Shield,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { MarketingCtaSection } from "@/components/marketing/MarketingCtaSection";
import { MarketingHeroSection } from "@/components/marketing/MarketingHeroSection";
import { MarketingPageShell } from "@/components/marketing/MarketingPageShell";
import { ENCRYPTION_SUMMARY, SYMMETRIC_CIPHER } from "@/lib/encryption-standards";

type FeatureCard = {
  title: string;
  description: string;
  icon: LucideIcon;
  visual: React.ReactNode;
};

const featureCards: FeatureCard[] = [
  {
    title: "AES-256 envelope encryption",
    description:
      "Per-file content keys are wrapped with AES-256-GCM before blobs reach Nebular OS. Plaintext keys never persist on disk — Grover's algorithm still leaves a 2^128 work factor.",
    icon: ShieldCheck,
    visual: (
      <div className="flex flex-col items-center gap-4">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-3 py-2 text-xs font-semibold text-[#1A1A1A]">
            <FileText className="size-3.5" aria-hidden />
            Source File
          </div>
          <ArrowRight className="size-4 text-[#888888]" aria-hidden />
          <div className="flex items-center gap-2 rounded-lg border border-[#27272A] bg-[#0A0A0A] px-3 py-2 text-xs font-semibold text-white">
            <Lock className="size-3.5" aria-hidden />
            Wrapped Key + Blob
          </div>
        </div>
        <div className="flex items-center gap-1.5 rounded-full border border-[#A7F3D0] bg-[#ECFDF5] px-2.5 py-1">
          <span className="size-1.5 rounded-full bg-[#10B981]" />
          <span className="text-[11px] font-bold text-[#065F46]">{SYMMETRIC_CIPHER} envelope</span>
        </div>
      </div>
    ),
  },
  {
    title: "Hybrid post-quantum TLS",
    description:
      "Protect AES keys in transit by terminating HTTPS with hybrid key exchange (ML-KEM + classical ECDHE/RSA) at your edge proxy — defending against harvest-now, decrypt-later attacks.",
    icon: Shield,
    visual: (
      <div className="flex flex-col items-center gap-4">
        <div className="flex items-center gap-3 text-[11px] font-semibold text-[#1A1A1A]">
          <Key className="size-4 text-[#2563EB]" aria-hidden />
          ML-KEM + ECDHE
        </div>
        <p className="text-center text-[11px] font-medium text-[#666666]">
          {ENCRYPTION_SUMMARY}
        </p>
      </div>
    ),
  },
  {
    title: "Distributed storage nodes",
    description:
      "Compressed blobs are routed to Nebular OS storage nodes with capacity-aware placement. Metadata stays in Postgres for fast queries and audit trails.",
    icon: Globe,
    visual: (
      <div className="flex flex-col items-center gap-4">
        <div className="flex gap-3">
          {["Node A", "Node B", "Node C"].map((node) => (
            <div
              key={node}
              className="flex w-[100px] flex-col items-center gap-1.5 rounded-lg border border-[#E5E7EB] bg-white px-3 py-2.5"
            >
              <Database className="size-4 text-[#2563EB]" aria-hidden />
              <span className="text-[10px] font-semibold text-[#666666]">{node}</span>
            </div>
          ))}
        </div>
        <p className="text-[11px] font-medium text-[#666666]">
          Storage nodes synced with capacity-aware routing
        </p>
      </div>
    ),
  },
  {
    title: "Tag-Based Smart Search",
    description:
      "Find what you need instantly. Local secure metadata indexing allows you to query your private tags without exposing any text or file names.",
    icon: Search,
    visual: (
      <div className="flex w-full flex-col gap-3">
        <div className="flex items-center gap-2 rounded-lg border border-[#E5E7EB] bg-white px-3 py-2">
          <Search className="size-3.5 text-[#666666]" aria-hidden />
          <span className="rounded-md border border-[#BFDBFE] bg-[#EFF6FF] px-2 py-0.5 text-[11px] font-semibold text-[#2563EB]">
            q4
          </span>
          <span className="text-xs text-[#1A1A1A]">|</span>
        </div>
        <div className="flex flex-col gap-2 text-xs text-[#666666]">
          <div className="flex justify-between">
            <span>project-brief.pdf</span>
            <span className="text-[#888888]">2.1 MB</span>
          </div>
          <div className="flex justify-between">
            <span>notes-q4.docx</span>
            <span className="text-[#888888]">840 KB</span>
          </div>
        </div>
      </div>
    ),
  },
  {
    title: "Instant Secure Sharing",
    description:
      "Share access via automated self-destructing links. Control who has access, track status in real-time, and revoke keys at any moment.",
    icon: Share2,
    visual: (
      <div className="flex w-full flex-col gap-2.5">
        <div className="flex items-center justify-between text-[11px] font-semibold text-[#1A1A1A]">
          <span>One-Time View (Burn on Read)</span>
          <div className="h-4 w-7 rounded-full bg-[#2563EB] p-0.5">
            <div className="ml-auto size-3 rounded-full bg-white" />
          </div>
        </div>
        <div className="flex items-center justify-between text-[11px] font-semibold text-[#1A1A1A]">
          <span>Link Expiration</span>
          <span className="rounded-md border border-[#E5E7EB] bg-white px-2 py-1 text-[10px]">24 hours</span>
        </div>
        <div className="flex gap-2">
          <div className="flex-1 truncate rounded-lg border border-[#E5E7EB] bg-white px-2.5 py-1.5 text-[10px] text-[#666666]">
            ownly.app/s/a8f3…
          </div>
          <button type="button" className="rounded-lg bg-[#2563EB] px-3 py-1.5 text-[10px] font-bold text-white">
            Copy
          </button>
        </div>
      </div>
    ),
  },
];

const processingSteps = [
  {
    step: "STEP 1",
    icon: Key,
    title: "1. Upload to Nebular OS",
    description:
      "Drive files are sent as plaintext bytes so Nebular zstd can compress them (NOSB block blobs). Video HLS paths encrypt segments before upload.",
    visual: (
      <>
        <div className="flex items-center gap-2 text-[11px] font-semibold text-[#1A1A1A]">
          <FileText className="size-3.5" aria-hidden />
          document.pdf (Raw Input)
        </div>
        <div className="flex items-center gap-2 text-[10px] font-bold text-[#2563EB]">
          <ArrowDown className="size-3.5" aria-hidden />
          → Nebular-OS Blob Stream
        </div>
      </>
    ),
  },
  {
    step: "STEP 2",
    icon: Cpu,
    title: "2. zstd in Nebular OS",
    description:
      "Nebular block-compresses eligible payloads with zstd (Compose default level 3). Periodic recompress can rewrite raw blobs as NOSB when smaller.",
    visual: (
      <>
        <div className="flex items-center gap-2 text-[11px] font-semibold text-[#2563EB]">
          <Lock className="size-3.5" aria-hidden />
          zstd Compressed Blob Stream
        </div>
        <div className="flex items-center gap-2 text-[10px] text-[#666666]">
          <ShieldCheck className="size-3.5" aria-hidden />
          Optimized payload size
        </div>
      </>
    ),
  },
  {
    step: "STEP 3",
    icon: Database,
    title: "3. Encrypted Nebular Storage",
    description:
      "Compressed blobs are written to Nebular OS while content keys remain wrapped with AES-256-GCM in Postgres. Terminate TLS with hybrid PQC at your edge for quantum-ready key exchange.",
    visual: (
      <>
        <div className="flex items-center gap-2 text-[11px] font-semibold text-[#1A1A1A]">
          <Cloud className="size-3.5" aria-hidden />
          nebular-os Storage Pool
        </div>
        <div className="flex items-center gap-2 text-[10px] font-bold text-[#2563EB]">
          <Key className="size-3.5" aria-hidden />
          Encrypted at rest.
        </div>
      </>
    ),
  },
];

export default function FeaturesPage() {
  return (
    <MarketingPageShell>
      <MarketingHeroSection
        badgeIcon={Sparkles}
        badgeLabel="POWERFUL PRIVACY ENGINE"
        title="High-performance blob storage built for modern speeds"
        subtitle="Discover how Ownly converts files into compressed Nebular OS blobs, wraps keys with AES-256-GCM, and supports hybrid post-quantum TLS at your edge."
      />

      {/* Human: 2×2 feature showcase grid from Pencil Features Showcase Grid Container */}
      <section className="grid w-full gap-6 lg:grid-cols-2">
        {featureCards.map((card) => {
          const Icon = card.icon;
          return (
            <article
              key={card.title}
              className="flex flex-col gap-6 rounded-2xl border border-[#E5E7EB] bg-white p-8"
            >
              <div className="flex flex-col gap-3">
                <div className="flex size-[42px] items-center justify-center rounded-lg border border-[#DBEAFE] bg-[#EFF6FF]">
                  <Icon className="size-5 text-[#2563EB]" aria-hidden />
                </div>
                <h2 className="text-lg font-bold text-[#1A1A1A]">{card.title}</h2>
                <p className="text-sm leading-relaxed text-[#666666]">{card.description}</p>
              </div>
              <div className="flex min-h-[160px] flex-col items-center justify-center rounded-xl border border-[#E5E7EB] bg-[#F7F8FA] p-6">
                {card.visual}
              </div>
            </article>
          );
        })}
      </section>

      {/* Human: Three-step Nebular-OS processing deep dive from Pencil Deep Dive Encryption Flow */}
      <section className="flex w-full flex-col items-center gap-10 rounded-2xl bg-[#F7F8FA] px-6 py-16 sm:px-12 lg:px-16">
        <div className="flex max-w-3xl flex-col items-center gap-3 text-center">
          <div className="flex items-center gap-1.5 rounded-full border border-[#E5E7EB] bg-white px-3 py-1">
            <Shield className="size-3.5 text-[#2563EB]" aria-hidden />
            <span className="text-[11px] font-bold text-[#666666]">NEBULAR-OS CORE ENGINE</span>
          </div>
          <h2 className="text-3xl font-bold text-[#1A1A1A] sm:text-4xl">How Nebular-OS Blob Processing Works</h2>
          <p className="text-[15px] leading-relaxed text-[#666666]">
            A quick technical breakdown of how we ingest, compress, and secure your files on our advanced object
            storage system.
          </p>
        </div>

        <div className="grid w-full gap-6 lg:grid-cols-3">
          {processingSteps.map((step) => {
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
                <div className="flex min-h-[120px] flex-col justify-center gap-2.5 rounded-lg bg-[#F7F8FA] p-4">
                  {step.visual}
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <MarketingCtaSection
        title="Ready to secure your digital files?"
        subtitle="Join thousands of individuals and teams who trust Ownly's high-speed nebular-os cloud."
      />
    </MarketingPageShell>
  );
}
