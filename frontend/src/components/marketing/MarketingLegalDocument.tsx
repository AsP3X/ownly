// Human: Prose layout for public legal pages — section headings, body copy, and optional subsections.
// Agent: RENDERS static children in a centered readable column; no API calls; matches marketing typography.

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type LegalDocumentSection = {
  id: string;
  title: string;
  content: ReactNode;
};

type MarketingLegalDocumentProps = {
  lastUpdated: string;
  effectiveDate: string;
  intro: ReactNode;
  sections: LegalDocumentSection[];
  className?: string;
};

export function MarketingLegalDocument({
  lastUpdated,
  effectiveDate,
  intro,
  sections,
  className,
}: MarketingLegalDocumentProps) {
  return (
    <article className={cn("mx-auto flex w-full max-w-3xl flex-col gap-10", className)}>
      <div className="flex flex-col gap-3 border-b border-[#E5E7EB] pb-8 text-sm text-[#666666]">
        <p>
          <span className="font-semibold text-[#1A1A1A]">Last updated:</span> {lastUpdated}
        </p>
        <p>
          <span className="font-semibold text-[#1A1A1A]">Effective date:</span> {effectiveDate}
        </p>
      </div>

      <div className="flex flex-col gap-4 text-[15px] leading-relaxed text-[#666666]">{intro}</div>

      <nav aria-label="Table of contents" className="rounded-xl border border-[#E5E7EB] bg-[#F7F8FA] px-6 py-5">
        <h2 className="mb-3 text-sm font-bold text-[#1A1A1A]">Contents</h2>
        <ol className="flex list-decimal flex-col gap-2 pl-5 text-sm text-[#666666]">
          {sections.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`} className="font-medium text-[#2563EB] hover:underline">
                {section.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <div className="flex flex-col gap-12">
        {sections.map((section) => (
          <section key={section.id} id={section.id} className="scroll-mt-24">
            <h2 className="mb-4 text-xl font-bold text-[#1A1A1A]">{section.title}</h2>
            <div className="flex flex-col gap-4 text-[15px] leading-relaxed text-[#666666]">{section.content}</div>
          </section>
        ))}
      </div>
    </article>
  );
}
