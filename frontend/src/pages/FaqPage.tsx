// Human: Public FAQ page — accordion Q&A list from Pencil Ownly Public FAQ Page.
// Agent: RENDERED at `/faq`; READS local openIndex state for expand/collapse; static copy from design.

import { useState } from "react";
import { ChevronDown, ChevronUp, Info } from "lucide-react";
import { MarketingCtaSection } from "@/components/marketing/MarketingCtaSection";
import { MarketingHeroSection } from "@/components/marketing/MarketingHeroSection";
import { MarketingPageShell } from "@/components/marketing/MarketingPageShell";
import { ENCRYPTION_SUMMARY } from "@/lib/encryption-standards";
import { cn } from "@/lib/utils";

type FaqItem = {
  question: string;
  answer: string;
  defaultOpen?: boolean;
};

const faqItems: FaqItem[] = [
  {
    question: "How does Nebular-OS high-performance storage secure my files?",
    answer:
      "Files are compressed into Nebular OS blobs and protected with AES-256-GCM envelope encryption. Per-file content keys are wrapped in Postgres and never stored in plaintext on object storage.",
    defaultOpen: true,
  },
  {
    question: "How are enterprise encryption keys and file security managed?",
    answer:
      `Ownly uses a hybrid quantum-resistant model: ${ENCRYPTION_SUMMARY}. Symmetric AES-256-GCM secures data at rest (Grover's algorithm still leaves 2^128 work factor). TLS at your reverse proxy should combine classical handshakes with NIST post-quantum algorithms such as ML-KEM to protect keys during transit against harvest-now, decrypt-later attacks. Passwords are hashed with Argon2id.`,
    defaultOpen: true,
  },
  {
    question: "Can I share files securely with non-Ownly users?",
    answer:
      "Yes. Ownly generates password-protected, time-limited share links that work in any browser. Recipients do not need an account — they access files through encrypted presigned URLs with optional burn-on-read and expiration controls.",
  },
  {
    question: "Where are my encrypted files stored?",
    answer:
      "File metadata lives in PostgreSQL while binary blobs are written to Nebular-OS on your configured storage backend. Blobs are spread across hashed directory prefixes for performance and encrypted at rest before they leave the upload pipeline.",
  },
  {
    question: "Is there an upload file size limit?",
    answer:
      "Limits depend on your plan and instance configuration. Free tiers support standard document and media uploads; Pro and Team plans raise throughput caps for large video and archive files. Your administrator can configure maximum upload sizes in instance settings.",
  },
];

export default function FaqPage() {
  // Human: Track which FAQ rows are expanded — design shows items 1–2 open by default.
  const [openIndices, setOpenIndices] = useState<Set<number>>(() => {
    const initial = new Set<number>();
    faqItems.forEach((item, index) => {
      if (item.defaultOpen) initial.add(index);
    });
    return initial;
  });

  function toggleItem(index: number) {
    setOpenIndices((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }

  return (
    <MarketingPageShell>
      <MarketingHeroSection
        badgeIcon={Info}
        badgeLabel="SUPPORT & FAQS"
        title="Frequently Asked Questions"
        subtitle="Got questions about Nebular-OS high-speed storage, blob compression, sharing permissions, or security? We have compiled detailed answers to help you navigate Ownly."
      />

      {/* Human: Accordion FAQ list from Pencil FAQ Content Container */}
      <section className="flex w-full flex-col">
        {faqItems.map((item, index) => {
          const isOpen = openIndices.has(index);
          return (
            <article
              key={item.question}
              className="border-b border-[#E5E7EB] py-6 first:pt-0"
            >
              <button
                type="button"
                className="flex w-full items-start justify-between gap-4 text-left"
                onClick={() => toggleItem(index)}
                aria-expanded={isOpen}
              >
                <span className="text-lg font-semibold leading-snug text-[#1A1A1A]">{item.question}</span>
                {isOpen ? (
                  <ChevronUp className="size-5 shrink-0 text-[#2563EB]" aria-hidden />
                ) : (
                  <ChevronDown className="size-5 shrink-0 text-[#666666]" aria-hidden />
                )}
              </button>
              <p
                className={cn(
                  "mt-4 text-[15px] leading-relaxed text-[#666666]",
                  !isOpen && "hidden",
                )}
              >
                {item.answer}
              </p>
            </article>
          );
        })}
      </section>

      <MarketingCtaSection
        title="Still have questions?"
        subtitle="Our support team is always here to help you manage your secure, high-performance Nebular-OS object storage."
      />
    </MarketingPageShell>
  );
}
