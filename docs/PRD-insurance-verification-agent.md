# Product Requirements Document (PRD)

## AI Insurance Verification & Benefits Intelligence Agent

| | |
|---|---|
| **Working name** | NightShift (branding TBD) |
| **Status** | Draft v1.0 |
| **Date** | July 2026 |
| **Author** | Founder (dentist-owner) + committee analysis (`dental-venture-discovery.md`) |
| **Beachhead** | Independent GP practices on OpenDental, 1–5 operatories, PPO-heavy, US |

---

## 1. Summary

NightShift is an AI agent that insurance-verifies every patient on tomorrow's schedule, overnight, without staff involvement. It confirms eligibility, retrieves **full plan-level benefit breakdowns** (coverage percentages, frequencies, waiting periods, downgrades, missing-tooth clauses, deductibles, maximums, history), calls payers by voice AI when portals can't provide the data, and **writes structured results back into OpenDental** so the front desk starts each day with a verified schedule and a short exception list.

The product replaces (a) 2–4 staff-hours/day of portal logins and phone hold time, (b) outsourced verification services at $3–8/patient, and (c) the downstream cost of eligibility-related denials and patient billing surprises.

This is the wedge product of a larger arc: verification data feeds patient out-of-pocket estimation (Phase 2) and claims/denial automation (Phase 3), toward "autonomous insurance operations for the dental practice."

## 2. Problem

1. **Verification is the highest-frequency drudge work in the practice.** Every patient, every day, must be verified before treatment or the practice eats the write-off. A typical 1,800-visit/quarter GP office runs 25–45 verifications per working day.
2. **The data that matters is hard to get.** Clearinghouse eligibility (X12 270/271) answers "is coverage active?" but not the questions that determine treatment planning and collections: downgrade clauses, frequency limits ("2 prophies per 12 months — is one used?"), waiting periods, missing-tooth clauses, deductible applied-to-date. That data lives in payer portals (inconsistent, shallow for some payers) and payer phone trees (30–45 minute holds).
3. **Errors are expensive and asymmetric.** A wrong or skipped verification becomes a denied claim (weeks of rework) or a surprise patient balance (angry patient, bad review, uncollectible AR).
4. **Current alternatives fail a specific way.** Outsourced verification services are slow (24–72h turnaround), error-prone, and return PDFs or spreadsheets that staff re-key. Existing software (Zuub, Verrific, Vyne) is shallow on breakdowns, doesn't call payers, and doesn't write back into OpenDental — so the front desk re-verifies anyway, destroying the value.

## 3. Goals and non-goals

### Goals (MVP)
- G1: ≥80% of scheduled patients fully verified with complete breakdowns, autonomously, before 7:00 AM local practice time.
- G2: ≥95% field-level accuracy on breakdowns vs. human audit.
- G3: ≥70% reduction in staff hours spent on verification within 30 days of onboarding.
- G4: Verified data written back into OpenDental in structured form (not just a PDF) with full provenance.
- G5: A morning exception queue that a front-desk employee can clear in <20 minutes.

### Non-goals (MVP)
- NG1: Patient out-of-pocket estimates (Phase 2 — depends on this product's data).
- NG2: Claims submission, tracking, denial recovery (Phase 3).
- NG3: PMS support beyond OpenDental (server and Cloud).
- NG4: Medicaid and medical (non-dental) plans. HMO/capitation plans are verify-eligibility-only in MVP.
- NG5: Patient-facing communication of any kind.
- NG6: Non-US payers.

## 4. Users and personas

| Persona | Role in purchase | Jobs to be done |
|---|---|---|
| **Office manager ("Dana")** | Champion, daily admin | Stop spending her best hours on portals/hold; trust that the schedule is verified; handle only exceptions |
| **Front-desk / verification coordinator ("Maria")** | Primary daily user | Morning exception queue; on-demand verification for add-ons/walk-ins; answer "what's my coverage?" at check-in |
| **Owner-dentist ("Dr. Chen")** | Economic buyer | Cut a cost line (outsourcer or half-FTE); fewer denials; accurate treatment-plan conversations |
| **Biller (often same as Dana)** | Beneficiary | Fewer eligibility denials; breakdown provenance when appealing |

Trust dynamic (critical): front desks re-verify behind tools they don't trust. The product must *earn* the right to be believed — via provenance (screenshots, call recordings), confidence labeling, and an accuracy feedback loop — or it delivers zero value regardless of automation rate.

## 5. Core user stories & requirements

Priorities: **P0** = MVP must-have, **P1** = fast-follow (≤2 quarters), **P2** = later.

### 5.1 Overnight batch verification (P0)
- As Dana, when I leave at 5 PM, tomorrow's schedule verifies itself overnight.
- **R1.** System reads the next N business days of appointments from OpenDental (default N=3; re-verifies day-before for changes).
- **R2.** For each patient: resolve subscriber/plan from OpenDental (`patplan`/`inssub`/`insplan`/`carrier`); run eligibility (270/271); if plan is new/changed/stale (>30 days) or high-value procedures are scheduled, retrieve a full breakdown.
- **R3.** Breakdown retrieval order: payer portal adapter → clearinghouse enrichment → AI voice call → human review queue. Each step records provenance.
- **R4.** All verifications for the next business day complete by 7:00 AM practice-local time (SLO: 95% of nights).
- **R5.** Add-on/changed appointments (booked same-day) trigger verification within 15 minutes of appearing in OpenDental.

### 5.2 Full benefit breakdown ("the good stuff") (P0)
- **R6.** Canonical breakdown includes at minimum: plan status & effective dates; annual maximum (total/used/remaining); deductibles (individual/family, applied-to-date, categories waived); coverage % by category (preventive/basic/major/ortho) **and** by CDT code range where the payer exposes it; frequencies & limitations with history (prophy, BWX, FMX, exams, SRP, crowns-per-tooth clause); waiting periods; missing-tooth clause; downgrade clauses (posterior composite→amalgam, crown material); ortho lifetime max; COB rule; assignment of benefits; fee schedule linkage if derivable.
- **R7.** Every field carries: value, source (portal page / 271 segment / call recording timestamp / human), confidence (high/medium/low), and retrieved-at timestamp.
- **R8.** Fields the payer will not disclose are marked `unavailable-from-payer` — never silently blank (an empty field must be distinguishable from "we didn't try").

### 5.3 AI voice calls to payers (P0, scoped)
- **R9.** For designated payers (launch set: top 2–3 phone-gated payers by practice volume), the system places calls, navigates IVR (DTMF + speech), waits on hold, conducts the rep conversation from a benefits script, and extracts the breakdown from the transcript.
- **R10.** Calls are recorded and transcribed (subject to consent rules — see §9); transcript + audio linked as provenance.
- **R11.** If the agent's confidence drops mid-call or the rep requests information the agent lacks, the call outcome routes to the human review queue with a partial breakdown (no improvisation).
- **R12.** Call disclosure: the agent identifies itself as calling **on behalf of [Practice name]** as an automated assistant, per configured script. It never claims to be a human.

### 5.4 OpenDental writeback (P0 — the moat feature)
- **R13.** Write structured results into OpenDental: benefit rows (`benefit` table semantics via API), insurance-plan notes, verification status (`insverify`), and a formatted human-readable summary as a Commlog entry / patient document (PDF).
- **R14.** Writeback is **additive and auditable**: original values preserved in history; every write tagged with agent identity; one-click revert per verification in the dashboard.
- **R15.** Supported deployments: OpenDental server (local MySQL, via on-prem connector) and OpenDental Cloud (via Open Dental API). Feature parity documented; API preferred wherever it covers the need.

### 5.5 Morning exception dashboard (P0)
- **R16.** Web dashboard, sorted by appointment time, states per patient: ✅ Verified / ⚠️ Attention (terminated coverage, new plan, waiting period hits scheduled procedure, frequency conflict, unmet deductible relevant to today, low confidence) / ⏳ In progress / ❌ Failed (reason + suggested action).
- **R17.** Each ⚠️ explains *why it matters for today's visit* in one sentence (e.g., "D1110 scheduled but 2/2 prophies used as of 03/14 — patient owes full fee").
- **R18.** One-click actions: mark handled; request re-verify; open provenance (portal screenshot / call audio at timestamp / 271 raw); escalate to support.
- **R19.** On-demand verification button (patient search → verify now) with live status.

### 5.6 Human review queue (P0 — internal + customer-visible)
- **R20.** Low-confidence or failed automated verifications route to a review queue worked by (initially) the founder's team; SLA 2 business hours during 6 AM–6 PM CT. The customer sees only the outcome and the status "being completed by our team."
- **R21.** Reviewer corrections are captured as labeled training/eval data (field-level).

### 5.7 Onboarding (P0)
- **R22.** Self-serve + white-glove hybrid: install on-prem connector (or connect Cloud API key), enter payer-portal credentials into the credential vault, map top payers, set practice hours/timezone, pick writeback preferences. Target: <2 hours of office-manager time, verified same week.
- **R23.** Portal credentials are practice-owned and delegated (the agent acts as practice staff); MFA enrollment flow supports TOTP and SMS-relay options (§ TDD).

### 5.8 Accuracy & trust loop (P0 minimal, P1 full)
- **R24 (P0).** Weekly accuracy digest: sampled audit results, automation rate, hours saved estimate, denial-relevant catches ("we flagged 3 terminated plans before the visit").
- **R25 (P1).** Ground-truth reconciliation: when EOBs/ERAs post in OpenDental (`claimproc`), compare actual adjudication vs. predicted benefits; feed discrepancies into per-payer accuracy models and the customer-facing accuracy report. This is the compounding data moat.

### 5.9 Phase 2+ (P1/P2, out of MVP)
- **P1:** Patient out-of-pocket estimate engine (per treatment plan, using verified benefits + fee schedules + history). Add-on SKU.
- **P1:** Multi-location admin (micro-groups), roles/permissions.
- **P2:** Claims status tracking & denial-recovery module (hybrid pricing, per discovery report).
- **P2:** Second PMS (Dentrix or Curve); DSO central-team tier.

## 6. UX principles

1. **Zero-training default.** Dana should understand the morning queue with no manual. Everything else is progressive disclosure.
2. **Provenance one click away, always.** Trust is the product. Screenshot/audio/271 behind every field.
3. **Exceptions, not reports.** The dashboard is a to-do list, not analytics. If everything verified clean, the correct morning experience is "nothing to do."
4. **Never lie about certainty.** Confidence labels are visually loud. `Verified (portal, today 4:12 AM)` ≠ `Estimated from plan history`.
5. **Live inside their world.** The summary artifact in OpenDental must look like (better than) the breakdown form staff fill by hand today — same vocabulary, printable, familiar.

## 7. Success metrics

| Metric | Target (Day 90 per practice) | Notes |
|---|---|---|
| Full-auto verification rate | ≥80% | No human touch, complete breakdown |
| Field-level accuracy (audited) | ≥95% | Weekly sampled audit + ERA reconciliation |
| Overnight SLO | 95% of nights, 100% by 7 AM | Per-practice |
| Staff-hour reduction | ≥70% | Baseline captured at onboarding |
| Front-desk re-verification rate | <10% of verified patients | Measured via portal-login telemetry where possible / survey |
| Exception queue clear time | <20 min/morning median | In-product timing |
| Logo churn | <2%/month | |
| NPS (office manager) | ≥50 | The champion metric |
| Payer coverage | ≥85% of encountered patient volume via portal+voice | Long tail to review queue |

Business validation gates (from discovery report): own clinic 60 days → 5 design partners → 10 paying practices at $499+/mo with churn <2%/mo.

## 8. Pricing & packaging (v1)

- **Core:** $499/mo per location (≤300 verifications/mo) · $799/mo (≤700) · ~$1.00/verification metered beyond. Annual prepay −15%.
- **Anchors:** outsourcers $3–8/patient; half-FTE ≈ $2,500+/mo.
- **Phase 2 add-on:** Estimates +$200/mo.
- No per-seat pricing (whole-office product). No long-term contracts in year one (confidence signal).

## 9. Compliance & legal requirements (product-level)

- **HIPAA:** Company is a Business Associate; BAA offered at signup (blocking requirement for go-live). All subprocessors (cloud, LLM, telephony, clearinghouse) under BAA; LLM endpoints zero-retention. Minimum-necessary PHI per verification.
- **Call recording:** payer benefit lines routinely announce recording (implied consent both ways); nonetheless apply per-state two-party-consent policy engine — where required and not covered by the payer's own announcement, the agent discloses recording at call start. Configurable per payer/state; legal review before launch.
- **Automation disclosure:** agent self-identifies as an automated assistant acting for the named practice (R12).
- **Portal access:** delegated practice credentials only; the practice attests it authorizes the agent as its workforce-equivalent tool. Per-payer ToS register maintained with counsel-reviewed posture (§ TDD risk register).
- **No clinical decisions:** the product reports payer-stated benefits; it never advises treatment. Disclaimer on estimates ("not a guarantee of payment") mirrors industry standard.
- **Data ownership:** the practice owns its data; export anytime (CSV/JSON); deletion on termination per BAA within 30 days (de-identified payer-behavior data retained — spelled out in ToS).
- **E&O / tech liability insurance** in place before first paying customer.

## 10. Rollout plan

| Phase | When | What |
|---|---|---|
| 0 — Customer Zero | Weeks 1–12 | Build MVP against founder's clinic; shadow mode → assisted → autonomous; instrument baseline metrics |
| 1 — Design partners | Weeks 8–20 | 5 practices (study club / OpenDental community), free, weekly calls; hit accuracy gates; convert to paid |
| 2 — Paid GA (quiet) | Weeks 20–32 | 10+ paying; onboarding hardened to <2h; payer coverage ≥85% in launch geographies; publish founder-clinic case study |
| 3 — Community launch | Month 8+ | OpenDental user forums/FB group, Dentaltown, Dental Nachos; referral program; begin Phase-2 estimates beta |

## 11. Risks (product) & mitigations

| Risk | Mitigation |
|---|---|
| Front desk doesn't trust results → re-verifies → churn | Provenance-first UX; accuracy digest; onboarding sets a "trust trial" (they audit us for 2 weeks) |
| Payer portal/API commoditization squeezes the easy layer | Value concentrated in long tail (phone-only payers, history, quirks) + writeback workflow + estimates |
| Funded competitors (Zuub, Verrific, Vyne, comms suites) | OpenDental-native depth, community channel, speed; do not compete on breadth |
| Accuracy incident harms a patient relationship | Confidence labeling, human queue below thresholds, incident SLA + make-good policy, E&O |
| Voice agent fails rep interactions at scale | Narrow launch payer set, partial-result handoff (R11), human queue backstop |
| Founder bandwidth (clinic + startup) | Clinic doubles as lab; review-queue staffing hired early; ruthless MVP scope (§3 non-goals) |

## 12. Competitive intelligence (living section)

| Player | Market | What we know | Exploitable weakness |
|---|---|---|---|
| **Zuub** | US, funded | Real-time eligibility + breakdowns, DSO-tilted GTM | Depth of plan-level quirks; OpenDental-native writeback |
| **Verrific** | US | Verification automation w/ human backing | Turnaround consistency; coverage long tail |
| **Vyne Dental** | US, established | Claims/attachments rails + verification add-on | Verification is an attach, not the product; UX |
| **Pearl** | US, funded | Imaging AI expanding into practice intelligence | Verification not core; no payer-ops DNA |
| **Cleer** | Canada, funded | AI agents call insurers directly; 200+ offices. **Field report (secondhand, n=1, 07/2026): pricey, slow turnaround, incomplete payer coverage** | All three axes are design choices we control: SLA (overnight batch by 7 AM), coverage floor (human review queue = no unsupported payer), price (AI-native unit cost ~$0.55–0.90/verification) |
| **eAssist / outsourcers** | US, services | $3–8/patient, 24–72h turnaround | Speed, structure (PDFs not PMS data), error rates |

**Positioning implications:** (1) never sell "AI" — sell the 7 AM SLA and the no-unsupported-payer guarantee, the two things field reports say incumbents miss; (2) price below outsourcer-equivalent, above self-serve tools, anchored to the half-FTE; (3) writeback into OpenDental is the demo moment — incumbents hand back documents, we hand back a updated PMS. Validate all of this against `discovery-interview-script.md` results before GA pricing is locked.

## 13. Open questions

1. Which clearinghouse partner for 270/271 (Stedi vs. DentalXChange vs. Onederful) — decision owed by TDD §6 evaluation, Week 2.
2. Whether OpenDental writeback of `benefit` rows should default ON or start summary-note-only for the first 2 weeks per practice (trust ramp).
3. Voice-call launch payer set — confirm from founder-clinic call logs (top payers by hold-time × volume).
4. Whether the review queue is staffed in-house from day one or founder-only until design-partner phase.
5. Estimate add-on timing: pull into MVP if design partners demand it (watch for this signal).
