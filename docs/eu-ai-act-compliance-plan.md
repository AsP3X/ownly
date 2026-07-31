# EU AI Act compliance plan — Ownly

**Status:** Planning baseline for project conformity review  
**Last updated:** 2026-07-31  
**Primary focus:** Transparency of AI-generated content (Article 50 AI Act) and the [Code of Practice on Transparency of AI-generated Content](https://digital-strategy.ec.europa.eu/en/policies/code-practice-ai-generated-content)  
**Legal note:** This document is an engineering and product compliance checklist, not legal advice. Final classification and obligations should be confirmed with qualified counsel for each deployment model (self-hosted personal use, commercial SaaS, enterprise on-prem).

---

## 1. Purpose

This plan inventories the **binding** EU AI Act rules and the **voluntary but authoritative** Code of Practice / Commission Guidelines that Ownly must later be checked against.

Use it as:

1. A **scope map** of what can apply to Ownly today and as AI features grow.
2. A **conformity checklist** for audits and PR gates.
3. An **implementation backlog** for marking, labelling, disclosure UX, documentation, and governance.

**Binding vs voluntary**

| Instrument | Nature | Effect |
|------------|--------|--------|
| Regulation (EU) 2024/1689 (**AI Act**), esp. Art. 50 | **Legal obligation** | Mandatory when in scope |
| [Commission Guidelines on Art. 50](https://digital-strategy.ec.europa.eu/en/policies/guidelines-transparency-ai-generated-content) (adopted ~20 Jul 2026) | Interpretative guidance | Primary reference for scope, exceptions, examples |
| [Code of Practice on Transparency of AI-generated Content](https://digital-strategy.ec.europa.eu/en/policies/code-practice-ai-generated-content) (final Jun 2026) | **Voluntary**; assessed as adequate by Commission & AI Board | Signatories may rely on CoP measures to demonstrate Art. 50(2)/(4)/(5) compliance; non-signatories must prove **equivalent** adequacy |
| [EU icons for AI labelling](https://digital-strategy.ec.europa.eu/en/policies/eu-icons-labelling-ai-generated-content) | Optional visual assets (part of CoP Section 2) | Icons alone ≠ compliance; placement + clear disclosure still required |
| GPAI Code of Practice (Art. 53/55) | Separate voluntary tool for **model** providers | Relevant only if Ownly becomes / integrates as a GPAI **model** provider |

---

## 2. Official sources (bookmark set)

| Resource | URL |
|----------|-----|
| Code of Practice overview (EN) | https://digital-strategy.ec.europa.eu/en/policies/code-practice-ai-generated-content |
| Code of Practice overview (DE) | https://digital-strategy.ec.europa.eu/de/policies/code-practice-ai-generated-content |
| Code of Practice PDF | https://ec.europa.eu/newsroom/dae/redirection/document/129555 |
| Guidelines overview | https://digital-strategy.ec.europa.eu/en/policies/guidelines-transparency-ai-generated-content |
| Guidelines PDF | https://ec.europa.eu/newsroom/dae/redirection/document/131215 |
| Art. 50 FAQ | https://digital-strategy.ec.europa.eu/en/faqs/transparency-obligations-under-article-50-ai-act |
| Quick facts | https://digital-strategy.ec.europa.eu/en/factpages/quick-facts-transparency-rules-ai-systems |
| EU icons | https://digital-strategy.ec.europa.eu/en/policies/eu-icons-labelling-ai-generated-content |
| Article 50 text | https://artificialintelligenceact.eu/article/50/ |
| Full AI Act (OJ) | Regulation (EU) 2024/1689 |
| GPAI Code of Practice | https://digital-strategy.ec.europa.eu/en/policies/contents-code-gpai |
| Signatory form / Q&A | Linked from CoP policy page |

---

## 3. Key dates and penalties

| Date | What applies |
|------|----------------|
| **2 Feb 2025** | Prohibited practices (Art. 5); AI literacy (Art. 4) |
| **2 Aug 2025** | GPAI model obligations (Ch. V); many governance/penalty rules |
| **2 Aug 2026** | **Article 50 transparency obligations apply** (default for Art. 50(1), (3), (4), (5)) |
| **2 Dec 2026** | **Grace period** for Art. 50(2) **machine-readable marking/detection** only, for generative AI systems **placed on the market before 2 Aug 2026** (AI Omnibus-related adjustment; confirm final text for product timeline) |
| Content generated **before 2 Aug 2026** | No mandatory retroactive labelling; Commission **encourages** labelling where possible |
| Annex III high-risk (standalone) | Track Digital Omnibus / national timelines (industry reports cite deferred Annex III dates; re-verify before any high-risk classification) |

**Fines (Art. 99 context for transparency non-compliance, Commission FAQ)**

- Up to **€15 million** or **3%** of total worldwide annual turnover (whichever higher) for many Art. 50-related breaches.
- Proportionality considerations for SMEs / small mid-caps.
- Enforcement mainly by **national market surveillance authorities**; AI Office for certain GPAI-built systems / VLOP-integrated cases; EDPS for EU institutions.

---

## 4. Role map: provider vs deployer

Under Art. 3 AI Act (as clarified in Guidelines / FAQ):

| Role | Definition (short) | Typical Ownly mapping |
|------|--------------------|------------------------|
| **Provider** | Develops an AI system (or has it developed) and places it on the market / puts it into service under own name/trademark | Ownly product org when shipping **AI features** (e.g. spreadsheet Copilot with LLM, future generative tools) |
| **Deployer** | Uses an AI system under its authority **except** purely personal non-professional use | Businesses / commercial operators using Ownly + AI features; **not** end-users in pure personal capacity |
| **Neither (hosting only)** | Mere hosting / transmission / dissemination of third-party content without controlling the AI system | Ownly as storage host of user-uploaded files **without** generating/manipulating them with AI — generally **not** Art. 50(4) deployer for that content |
| **Upstream model provider** | GPAI / foundation model provider | Third-party LLM vendors Ownly may call; Ownly remains responsible as **system** provider for Art. 50 if it puts a generative system into service |

**Important exclusions (Guidelines §2.4)**

- Purely **personal non-professional** deployer activity (e.g. private deepfake for social media) is outside AI Act scope for that person as deployer — **not** a free pass for Ownly as provider if Ownly ships the generating system.
- **R&D** carve-outs (narrow).
- Free/open-source release has **limited** AI Act carve-outs; Art. 50 transparency is **not** generally waived for open-source generative systems exposed to people / content.

---

## 5. Article 50 — four transparency pillars (binding)

Article 50 applies to **all** AI systems in these situations (not only “high-risk”).

### 5.1 Art. 50(1) — Interactive AI (provider)

**Rule:** AI systems **intended to interact directly** with natural persons must be designed so persons are **informed** they are interacting with AI, unless obvious to a reasonably well-informed, observant, circumspect person.

**Guidelines cumulative criteria (FAQ):**

1. Qualifies as an AI system  
2. Designed for genuine **two-way** exchange (not mere data collection / one-shot automation)  
3. Interaction is **direct** (AI communicates with the person)  
4. Interaction is with **natural persons**

**Exceptions:** obvious AI interaction (restrictive); certain law-enforcement systems.

**Horizontal (Art. 50(5)):** Clear, distinguishable notice **at latest at first interaction**; meet **accessibility** requirements.

**Ownly relevance**

| Feature | Likely in scope? | Notes |
|---------|------------------|-------|
| Spreadsheet **Copilot** (chat-style assistant) | **Yes** once it is AI (LLM) | Today: heuristic-only (`source: "heuristic"`). When LLM is productized → Art. 50(1) disclosure |
| File browser / storage UI | No | Not AI interaction |
| Background thumbnail/transcode jobs | No | No direct natural-person interaction |

**Compliance measures (when in scope)**

- [ ] Persistent UI disclosure: “You are interacting with an AI assistant” (or equivalent) at first open / first message  
- [ ] Do not bury notice only in T&Cs  
- [ ] Accessible: visible contrast, screen-reader text, no flash-only labels  
- [ ] Document “obviousness” assessment if relying on exception (prefer **not** relying on it for chat UIs)

---

### 5.2 Art. 50(2) — Machine-readable marking & detection (provider)

**Rule:** Providers of AI systems (including general-purpose AI systems) that generate **synthetic audio, image, video or text** must ensure outputs are:

1. Marked in a **machine-readable** format, and  
2. **Detectable** as artificially generated or manipulated  

Technical solutions must be **effective, interoperable, robust and reliable** as far as **technically feasible**, considering content type, cost, and state of the art / standards.

**Out of scope / exceptions (Guidelines + legal text)**

- Assistive **standard editing** that does **not substantially alter** input or its semantics (e.g. spellcheck, grammar, noise reduction, color correction — case-by-case)  
- Certain short / non-content outputs (e.g. short symbol sequences; **source code** cited in FAQ as out of scope for marking)  
- Machine-to-machine only / closed industrial loops (conditions apply)  
- Law-enforcement authorised systems  
- Narrow B2B/industrial exemptions per Guidelines  

**Ownly relevance**

| Feature | Art. 50(2)? | Notes |
|---------|-------------|-------|
| LLM Copilot text replies | **Yes** if generative synthetic text is produced by Ownly-as-provider | Marking + detection pathway required |
| Future image/video/audio generation or heavy AI manipulation | **Yes** | Full multi-layer marking |
| Video HLS / thumbnails / OCR / standard media processing | Usually **no** if standard assistive processing only | Re-assess if AI “substantially alters” content or semantics |
| User-uploaded files stored as-is | **No** for Ownly as generator | Storage ≠ generation |

---

### 5.3 Art. 50(3) — Emotion recognition & biometric categorisation (deployer)

**Rule:** Deployers must **inform** natural persons exposed to emotion recognition or biometric categorisation systems; personal data processing must comply with GDPR etc.

**Also check Art. 5 prohibitions** (already in force) for banned workplace/education emotion recognition and certain biometric uses.

**Ownly relevance (current product):** **None expected** unless features are added for face/voice emotion or biometric categorisation of people.

**Checklist if ever added**

- [ ] Pre-screen against Art. 5 prohibitions  
- [ ] First-exposure notice to exposed persons  
- [ ] DPIA / lawful basis under GDPR  
- [ ] Law-enforcement exception only if strictly applicable  

---

### 5.4 Art. 50(4) — Deepfakes & public-interest text (deployer)

**Deepfakes (Art. 3(60)) — cumulative:**

1. AI-generated or manipulated **image, audio or video**  
2. Resembles **existing** persons, objects, places, entities or events  
3. Would **falsely appear authentic or truthful** to a person  

**Deployer must disclose** artificial generation/manipulation clearly (human-perceivable — **not** satisfied by machine-readable marks alone).

**Public-interest text:** Deployers publishing AI-generated/manipulated text **to inform the public on matters of public interest** must disclose, **unless**:

- Human **review/editorial control** **and** a natural/legal person holds **editorial responsibility**, or  
- Law-enforcement authorised use  

**Public interest examples (FAQ):** politics, public admin, justice, fundamental rights, security, public health, environment, consumer safety, significant economic/cultural debate topics.

**Human review bar:** Substantive review by knowledgeable persons / real editorial authority — **not** spellcheck-only.

**Artistic/creative/satirical/fictional works:** Disclosure still required but may be in a manner that does **not hamper display/enjoyment**.

**Ownly relevance**

| Scenario | Art. 50(4)? | Notes |
|----------|-------------|-------|
| Ownly ships no deepfake generator | Ownly not deployer of deepfakes | Still consider product policies if users upload deepfakes |
| Business user generates deepfakes via Ownly AI tools | That **business** is deployer | Product should help them label |
| Ownly marketing/docs with AI images of real people | Ownly as deployer | Label if deepfake criteria met |
| Public-interest AI news text published by a customer | Customer deployer | Editorial-review carve-out if real |
| Mere hosting of user content | Generally **not** deployer under Guidelines | DSA may still apply for platforms at scale |

---

### 5.5 Art. 50(5) — Horizontal information quality

All Art. 50(1)–(4) information must be:

- **Clear and distinguishable**  
- Provided **at latest at first** interaction or exposure  
- Conform to **accessibility** requirements  

Fail patterns: tiny footer text, faint watermark, one-frame flash, disclosure only in Terms.

---

### 5.6 Art. 50(6)–(7)

- Does not replace high-risk Chapter III or other Union/national transparency rules.  
- AI Office facilitates codes of practice; CoP + possible implementing acts for common rules.

---

## 6. Code of Practice — detailed compliance framework

**Scope of CoP:** Practical measures for **Art. 50(2), (4) and (5)** only.  
**Not covered by CoP (use Guidelines instead):** Art. 50(1) interactive disclosure; Art. 50(3) emotion/biometrics.

**Signing:** Sections 1 (providers) and 2 (deployers) can be signed **independently**. Signing is voluntary; Art. 50 remains mandatory.

### 6.1 Section 1 — Providers (marking & detection)

#### Commitment 1 — Marking

| Measure | Requirement | Ownly implementation notes |
|---------|-------------|----------------------------|
| **1.1 Machine-readable marking** | At least one machine-readable technique meeting effectiveness/reliability/robustness/interoperability | Required for generative outputs Ownly provides |
| **1.1 multi-layer (state of the art)** | For content that can be disseminated online: typically **≥2 layers** until a single technique is proven equivalent | Default target for images/audio/video/containerised text |
| **1.1.1 Digitally signed metadata** | If format supports metadata: record AI-generated/manipulated status; **digitally signed** & time-stamped where possible; secure key handling | Prefer open standards (e.g. C2PA Content Credentials / similar state-of-the-art) for media; for text in containers, signed metadata in file formats Ownly exports |
| **1.1.2 Imperceptible watermark** | Watermark embedded hard to strip; free-form text **>200 tokens** still needs watermarking (reliability may be lower) | LLM responses: token-level / statistical watermark if model provider supports it; else post-hoc + document residual risk |
| **1.1.3 Fingerprinting/logging (optional)** | Supplementary only; never sole solution; GDPR-safe, user control over logs | Prefer **not** logging full prompts/outputs unless product need + legal basis |
| **1.2 Non-removal of markings** | Best efforts to preserve marks on inputs and Ownly outputs; no “strip watermark” feature | Strip/export pipelines must preserve provenance; document intentional removals only where legally required |
| **1.3 Provenance transparency (optional)** | Richer metadata (without unnecessary privacy/business-sensitive data) | Optional second-layer provenance UI |
| **1.4 Perceptible markings (optional)** | User-visible marks in addition to machine-readable | Nice-to-have for Copilot exports |

**Single-layer exceptions under CoP:** closed physical-product environments; free-form text (single watermark layer may suffice for text).

#### Commitment 2 — Detection

| Measure | Requirement |
|---------|-------------|
| **2.1 Detection mechanisms** | Provide mechanisms so markings can be detected (public or controlled access depending on modality/risk; free-form text detection may be expert-restricted) |
| **2.2 Forensic detection (optional)** | Model/output forensics when markings fail |
| **2.3 Disclosure of detection results** | Clear, accessible presentation of detection outcomes |
| **2.4 Literacy (optional)** | Help users understand marking/detection |

**Ownly product implication:** If Ownly is a **provider** of generative systems, ship or integrate a **verify** path (API or UI) for content Ownly marked. If Ownly only **hosts** third-party content, optional “AI provenance viewer” is a product differentiator but not automatically an Art. 50(2) duty for foreign-generated bytes.

#### Commitment 3 — Quality of technical solutions

| Measure | Meaning |
|---------|---------|
| **3.1 Effectiveness** | Marks work for intended detection use; user-based assessment of detection UX |
| **3.2 Reliability** | Low false positive/negative under defined conditions |
| **3.3 Robustness** | Survive common transforms (compression, re-encoding, crop, mild edit) **as far as feasible** |
| **3.4 Interoperability** | Prefer open standards / widely supported metadata schemes so other parties can read marks |
| **3.5 State of the art (optional)** | Participate in advancing standards |

#### Commitment 4 — Testing, verification, compliance ops

| Measure | Requirement |
|---------|-------------|
| **4.1 Compliance process** | Documented process mapping CoP measures → systems |
| **4.2 Testing, verification, monitoring** | Internal tests until external benchmarks exist; retain evidence |
| **4.3 Training** | Staff who implement/operate generative features |
| **4.4 Cooperation with authorities** | Respond to market surveillance information requests |

---

### 6.2 Section 2 — Deployers (labelling deepfakes & published text)

#### Commitment 1 — Disclosure design & placement

| Measure | Requirement |
|---------|-------------|
| **1.1 Design specifications** | Use **EU icon set** or **equivalent** clear label; taxonomy: basic “AI”, “AI Generated”, “AI Modified” |
| **1.2 Placement** | Perceivable at **first exposure**; no intervening overlays hiding label; preferably **embedded** in content (survives download/reshare) or equivalent durable UI overlay; audio: disclaimer/tone at start + reminders; video: persistent or opening + periodic |
| **1.3 Task force (optional)** | Participate in CoP task force on icon evolution |

**EU icons (optional assets; free to use)**

- Basic **AI** icon — AI involved; or with custom text / second interactive layer  
- **AI Generated** — fully AI-generated, no human content/editorial control (beyond prompting)  
- **AI Modified** — pre-existing human content partially AI-modified into deepfake / public-interest text  

Variants: black, white, 50% transparency; SVG/PNG packages on Commission site.  
User testing: performance improves when icon + short text (e.g. “AI modified”).

**Accessibility for labels**

- Adequate size/contrast  
- Plain language; avoid jargon (except “AI”)  
- Alt text / ARIA for assistive tech  
- Timed disclosures long enough to read  
- Second-layer info navigable with assistive tech  

#### Commitment 2 — Internal processes

- Document how disclosure is applied (examples)  
- Staff awareness / literacy proportionate to size  
- Review/feedback loops; cooperate with authorities  
- Process for missing/incorrect labels  

#### Commitment 3 — Artistic/creative works

- Limited disclosure that does not hamper enjoyment, still must disclose existence of generation/manipulation  

#### Commitment 4 — Human review / editorial control (text)

- Document process if relying on Art. 50(4) text exemption  
- Substantive review + named editorial responsibility  

---

## 7. Broader AI Act obligations (beyond Art. 50)

Check these in the same conformity programme so “Art. 50 only” work does not miss higher-risk exposure.

| Topic | Articles | Ownly current assessment | Action if status changes |
|-------|----------|---------------------------|---------------------------|
| **AI literacy** | Art. 4 | Applies to providers/deployers ensuring sufficient AI literacy of staff | Document training for anyone building/supporting AI features |
| **Prohibited practices** | Art. 5 | No social scoring, real-time remote biometric ID in public (exceptions), workplace emotion recognition, untargeted facial scrapers, etc. | Feature gate any biometrics/emotion |
| **High-risk systems** | Ch. III, Annex III | Core cloud storage is **not** typical Annex III; careful if AI used for employment, education scoring, biometric ID, critical infrastructure, etc. | Formal classification worksheet before new AI use cases |
| **GPAI models** | Art. 51–55 | Ownly is **not** a foundation model provider today | If training/publishing GPAI models: technical docs, training-data summary, copyright policy, systemic-risk duties if applicable |
| **Downstream of GPAI** | Art. 53 info from model providers | When integrating third-party LLMs | Contract for Art. 50-friendly watermarking, documentation, usage policies |
| **Codes of conduct** | Art. 95 | Optional broader voluntary codes | Low priority |
| **Serious incidents / market surveillance** | Ch. IX | Mostly high-risk / GPAI heavy | Monitor if classification changes |
| **Penalties** | Art. 99–101 | See §3 | Maintain compliance evidence pack |

**Related Union law (often co-applies)**

- **GDPR** — prompts, logs, biometric data, training data  
- **DSA** — if Ownly becomes a hosting/platform service at regulated scale (content moderation, deepfake dissemination duties for VLOPs differ from Art. 50 deployer duties)  
- **Copyright / DSM Directive** — TDM opt-outs for training; not Art. 50 but relevant for any model training  
- **Accessibility acts** — reinforce Art. 50(5)  

---

## 8. Ownly product inventory (baseline for conformity checks)

### 8.1 Current AI / AI-adjacent surfaces (repo snapshot)

| Surface | Location / notes | Generative AI today? | Primary Art. 50 angle |
|---------|------------------|----------------------|------------------------|
| Spreadsheet Copilot API | `POST /api/v1/spreadsheet/copilot`; heuristic replies; `source: "heuristic"`; LLM “optional” in roadmap | **No** (heuristic) | Future **50(1)** + **50(2)** when LLM ships |
| Excel Copilot UI | `ExcelCopilotSidebar` etc. | Same | Disclosure UX when AI |
| Media pipelines | Transcode, thumbnails, PDF/image previews | Assistive processing | Usually out of 50(2) if standard editing only |
| Collab editors (Excel, RTF, text) | Human collaboration | No | — |
| Public share pages | User-hosted content distribution | No generation | Hosting posture; optional provenance display |
| Admin / security tooling | No generative AI | No | — |

### 8.2 Planned / risk-sensitive directions

Track these in the improvement roadmap before enablement:

1. Wire real LLM behind Copilot (`docs` notes “Wave 5 / productize LLM”).  
2. Any generative image/video/audio features.  
3. AI “enhance / rewrite / auto-document” that **substantially alters** semantics.  
4. Any emotion or biometric analysis of user media.  
5. Public-facing AI-generated marketing or help content about public affairs.

### 8.3 Role scenarios to classify per deployment

| Deployment | Ownly role | Customer role |
|------------|------------|---------------|
| Individual self-host, personal use, no generative AI | Not Art. 50 provider for generative content | Personal activity exclusion for deployers |
| Individual self-host + Ownly ships generative Copilot | Ownly = **provider** of that AI system | Personal use of Copilot may limit **deployer** Art. 50(4) for that individual; provider duties remain |
| Company self-host / commercial license | Ownly = provider of AI features | Company = **deployer** of those features for professional use |
| Hypothetical hosted multi-tenant SaaS | Ownly may be provider **and** (for its own use of AI) deployer | Tenant may also be deployer for professional publication |

---

## 9. Conformity audit plan (later execution)

Use this section as the **check against the project** procedure.

### Phase A — Classification (legal + product)

1. [ ] Inventory every feature that is or embeds an “AI system” under Art. 3.  
2. [ ] For each: provider / deployer / out of scope; modalities (text/image/audio/video).  
3. [ ] Map to Art. 50(1)–(4) and high-risk / prohibited screens.  
4. [ ] Decide CoP signing strategy (Section 1 / Section 2 / neither + equivalent evidence).  
5. [ ] Record geographic offer: outputs used in the EU → AI Act can apply even if provider is outside EU.

### Phase B — Gap analysis vs binding rules

For each in-scope system:

| Check ID | Requirement | Pass criteria |
|----------|-------------|---------------|
| T50-1 | Interactive disclosure | First-interaction notice; accessible; not T&C-only |
| T50-2a | Machine-readable mark on synthetic outputs | Present on all in-scope exports/API responses as designed |
| T50-2b | Detectability | Documented detection method available |
| T50-2c | Quality | Evidence of effectiveness/reliability/robustness/interoperability testing |
| T50-2d | Exceptions | Written rationale for standard-editing / OOS claims |
| T50-3 | Emotion/biometric notice | N/A or first-exposure notice + GDPR |
| T50-4a | Deepfake human-visible label | EU icon or equivalent; first exposure; survives share/download where feasible |
| T50-4b | Public-interest text label | Label or documented editorial-responsibility process |
| T50-5 | Clarity & accessibility | UX review + a11y checks |
| GOV-1 | AI literacy | Training records for AI feature owners |
| GOV-2 | Prohibited practices | Design review signed off |
| GOV-3 | Vendor contracts | LLM/vendor watermarking + docs + opt-out for misuse |

### Phase C — Gap analysis vs CoP (if relying on it)

**Provider Section 1:** Measures 1.1–1.2, 2.1, 2.3, 3.1–3.4, 4.1–4.4 mandatory-style “will” measures; optionals tracked separately.

**Deployer Section 2:** Measures 1.1–1.2, 2.1–2.3; Commitments 3–4 where applicable.

### Phase D — Technical verification (engineering)

1. [ ] Golden tests: generative output files contain expected metadata/watermark.  
2. [ ] Robustness suite: re-encode/compress/crop mild transforms; re-detect marks.  
3. [ ] UI snapshot tests: AI disclosure + labels visible at first exposure.  
4. [ ] Negative tests: non-AI paths do **not** falsely label; no silent mark stripping.  
5. [ ] Security review of signing keys for metadata (local self-host key handling caveats in CoP).  
6. [ ] Privacy review of any fingerprinting/logging (CoP 1.1.3).  

### Phase E — Evidence pack (for authorities / customers)

Store under version control or compliance vault:

- Classification matrix (this plan §8 updated)  
- Architecture description of generative features  
- Marking/detection design + test reports  
- UX copy for disclosures (all locales)  
- Accessibility report  
- Staff literacy records  
- Third-party model provider terms & capabilities  
- Decision log for exceptions (standard editing, editorial control, artistic works)  
- CoP signatory status (if any)  

### Phase F — Ongoing monitoring

- [ ] Re-check Commission Guidelines / CoP updates quarterly  
- [ ] Feature flag any new AI modality until Phase A–D pass  
- [ ] Incident process for missing labels / mark failures  
- [ ] Customer documentation: how deployers should label deepfakes when using Ownly AI tools  

---

## 10. Implementation roadmap (engineering backlog)

Prioritised for Ownly’s likely path (storage-first, Copilot LLM next).

### P0 — Before any generative LLM is enabled in production

1. **Art. 50(1) disclosure UX** for Copilot (and any chat AI).  
2. **Art. 50(2) marking design** for text outputs (watermark and/or signed container metadata); vendor selection that supports watermarking where possible.  
3. **Detection** path for Ownly-marked text (even if expert-restricted initially for free-form text).  
4. **Policy & docs:** when Ownly is provider vs when customer is deployer; no claim that “storage alone” fulfils deployer labels.  
5. **Audit logging** of AI feature use (already partial for Copilot) without over-retaining content contrary to GDPR.  
6. **Feature flag** generative AI behind explicit compliance checklist.

### P1 — Before generative media (image/audio/video) features

1. Multi-layer marking: **signed metadata (C2PA or equivalent) + imperceptible watermark**.  
2. Preserve marks through Ownly export/download/share pipelines.  
3. Deployer labelling helpers: embed EU icons / “AI Generated” / “AI Modified” in editors and share views when content is deepfake-class.  
4. Robustness tests for common re-encodes used by Ownly media stack.

### P2 — Platform differentiators (not always mandatory)

1. **Provenance viewer** for uploaded media (read C2PA / AI metadata from third parties).  
2. Optional perceptible AI badges in file list when metadata indicates AI origin.  
3. Admin compliance report: AI features enabled, mark verification status.  
4. Evaluate **signing** CoP Section 1 (and Section 2 if Ownly publishes generative marketing content).

### P3 — Governance maturity

1. AI literacy programme for contributors.  
2. Formal high-risk / prohibited-practice review gate in PR template.  
3. Market surveillance contact & response playbook.  
4. Localisation of labels (AI / KI / IA etc.) matching EU icon guidance.

---

## 11. Decision log (fill during conformity work)

| Date | Decision | Owner | Rationale |
|------|----------|-------|-----------|
| 2026-07-31 | Create this plan from Art. 50, Guidelines, CoP (final), EU icons | Engineering | Baseline for future conformity audit |
| _TBD_ | CoP signatory? (Sec 1 / Sec 2 / none) | Product + Legal | Burden vs legal certainty |
| _TBD_ | LLM provider & watermark capability | Engineering | Art. 50(2) feasibility |
| _TBD_ | Standard-editing claims for media pipelines | Engineering + Legal | Art. 50(2) exception |
| _TBD_ | Self-host signing key model for metadata | Engineering | CoP 1.1.1 local deployment caveat |

---

## 12. Quick reference: “must vs optional”

| Item | Must (if in scope) | Optional |
|------|--------------------|----------|
| Inform user they chat with AI (50(1)) | Yes | — |
| Machine-readable mark + detectability (50(2)) | Yes | Multi-layer / C2PA strongly expected under CoP |
| Emotion/biometric notice (50(3)) | Yes if feature exists | — |
| Human-visible deepfake / public-interest text label (50(4)) | Yes for deployers | EU official icons specifically |
| Accessibility of notices (50(5)) | Yes | — |
| Sign CoP | No | Yes — best path to demonstrate 50(2)/(4)/(5) |
| Forensic detection | No | CoP optional |
| Fingerprint/log all outputs | No | CoP optional; privacy-sensitive |
| Retroactive label pre-2026-08-02 content | No | Encouraged |

---

## 13. Next step

Run **Phase A classification** against the live codebase and roadmap, then produce a short **gap report** (pass/fail per Check ID in §9 Phase B) with concrete tickets for P0 items before enabling any generative LLM in Ownly.

When ready, use this file as the audit rubric:

```text
docs/eu-ai-act-compliance-plan.md  →  classification matrix  →  gap report  →  P0 tickets  →  evidence pack
```
