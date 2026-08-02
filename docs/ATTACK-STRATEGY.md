# Attack Strategy — Winning Dental Insurance Ops as the Last Entrant

**Date:** July 2026 · **Status:** working strategy v1
**Inputs:** discovery reports (Rounds 1–2), verified competitor survey (PRD §12), Cleer field report, NightShift prototype (working).

---

## 1. The strategic read

Twelve-plus companies now sell dental insurance **verification**. They are all selling the same thing to the same buyer with the same pitch (replace front-desk labor, $300–800/mo), which means the category's future is margin compression and a CAC war — a race we cannot win as a bootstrapped tenth entrant, and a race not worth winning.

But the crowd shares one structural blind spot: **every one of them works the *front* of the money flow (predicting benefits) and none of them audits the *back* (what payers actually paid vs. what contracts require).** They generate predictions; nobody grades them. Nobody holds the payer accountable for the adjudication. That back half is where the money that's already owed to the practice sits — and it is empty of funded competitors.

**The strategy is therefore not "better verification." It is: enter through the uncontested back of the revenue cycle (payment integrity), own the ground-truth money data, and use that position to commoditize the front — turning the crowded category from our battlefield into our feature list.**

Working names: **Recoup** (the wedge product) on the **NightShift** platform (the infrastructure we already built).

---

## 2. Positioning: change what the fight is about

| | The crowd (Foji, Azops, Zuub, Stratus, Hestia, Pearl, Overjet…) | Us |
|---|---|---|
| Sells | Labor replacement ("we verify so staff doesn't") | **Money recovery + payer accountability** ("payers owe you; we collect, then keep them honest") |
| Pricing | SaaS $300–800/mo — a new cost line | **Contingency on recovered dollars** — no budget needed, self-justifying |
| Proof | Demo + testimonials | **The customer's own recovered money** in week one |
| Data | Benefit *predictions* (unverified) | **Adjudication ground truth** (EOBs vs. contracts) |
| Enemy in the story | The front desk's workload | **The payer** — emotionally correct for every practice owner |

One-line pitch: *"Every verification company guesses what insurance will pay. We audit what insurance actually paid — and collect the difference."*

This is counter-positioning in the strict sense: the incumbents **cannot follow without breaking themselves**. A verification vendor that launches underpayment recovery (a) needs the EOB/contract corpus it doesn't collect, (b) invites contingency pricing that cannibalizes its SaaS line, and (c) implicitly admits its own breakdowns were wrong — recovery finds the errors verification caused.

---

## 3. The moat, designed explicitly

A moat that "stands out" has to be structural, not adjectival. Five reinforcing layers, in order of importance:

### 3.1 The ground-truth flywheel (primary moat)
Verification products emit predictions. Recovery products ingest **outcomes** — every EOB is a labeled example of what a specific payer × plan × employer group × CDT code *actually* adjudicates. Nobody else collects this joined to contracts. Compounding uses:
- **Recovery gets better**: payer-behavior patterns (bundling tricks, downgrade misapplications, leased-network rate substitutions) transfer across practices — the 50th client's audit is sharper than the 1st's.
- **The only accurate benefits database in dentistry**: our "verification" answers are eventually *reconciled against reality*. Every competitor's are not. This is the weapon for Phase 3 (§5).
- **Benchmark data no one can shortcut**: real allowed-amounts by CDT × payer × zip. The fee-benchmarking business Round 1 killed for cold-start is a *by-product* here.
- Structural note: the corpus is **de-identified payer/plan behavior, not PHI**, so it survives customer churn and compounds forever (already engineered this way in the TDD §5).

### 3.2 Contingency economics as a competitive weapon
"Free audit of your last 12 months; you keep the first $2,500 we find; we take 25–30% after that" is an offer with ~zero CAC, ~zero risk-of-no, and days-long sales cycles. Every SaaS competitor must ask for budget; we ask for read-only access. And once we're recovering money, *switching away has a visible dollar cost* — churn means giving up found money.

### 3.3 OpenDental-native depth + the community channel
Unchanged from Round 1 and still real: authorized integration, direct DB fluency, writeback, and the founder-dentist voice in the OpenDental/Dentaltown/study-club channel where these buyers actually live. Foji has the integration; Foji does not have a practicing dentist publishing his own clinic's recovered-dollars numbers.

### 3.4 Clinical authority in disputes
Underpayment disputes and downgrade appeals carry more force signed by a treating dentist who can argue clinical necessity than from a software vendor's form letter. Competitors cannot hire their way into this cheaply; the founder *is* it.

### 3.5 The adversarial tax (shared with Round 1, still true)
Payers resist audit the way portals resist scraping. Every recoup fight teaches payer-specific evidence standards and escalation paths. This grind repels thin AI wrappers — the same filter that kept casual entrants out of verification keeps them out here, but *we* arrive with the NightShift extraction/orchestration stack already built.

---

## 4. What we do with verification (the twist)

We do **not** throw the prototype away, and we do not sell it at $499/mo into a knife-fight. Verification becomes ammunition:

1. **Internal**: it runs in our own clinic and design partners as the front-half data collector — its predicted benefits, reconciled against incoming EOBs, seed the accuracy corpus (TDD §3.8's loop, now strategic rather than aspirational).
2. **Bundled, later, at a disruptive price**: once recovery revenue carries the company (Phase 2+), verification ships to recovery clients at $99–149/mo or free-with-recovery — not to win the verification market, but to **collapse the price umbrella** the twelve competitors live under. We can price it as a feature because our revenue is contingency; they cannot follow because it is their whole income.
3. **As the public report card**: with adjudication ground truth we can measure — and publish — how often "verified" benefits (anyone's) diverge from actual payment. "The State of Dental Verification Accuracy" is a PR weapon only we can write.

---

## 5. Phased attack plan

### Phase 0 — Proof (months 0–3, cost <$10k)
- Run the discovery script (docs/discovery-interview-script.md) with the two added payment-integrity questions; 10–12 interviews including the Cleer-using friend.
- Build the audit instrument **PMS-agnostic** (decision 07/2026): CSV claims export + optional fee schedules in, findings + evidence report out — so *any* practice on *any* PMS can take the free-audit offer with zero integration. Where fee schedules are missing, reconstruct de facto rates from the payer's own modal allowed amounts. (Implemented as `apps/recoup-audit`.) The deeper NightShift integration (live EOB ingestion, dispute generation, writeback) follows for practices that convert to ongoing monitoring. 6–8 weeks, 2 engineers.
- **Audit our own clinic + the friend's practice.** Recover real dollars. Document everything.
- *Kill gates:* <$5k found across two practices' trailing year → the leakage thesis is wrong for our payer mix; stop or re-scope. Interviews show nobody cares about found money (unlikely) → stop.

### Phase 1 — Beachhead (months 3–9): "the free audit"
- 25 OpenDental practices via community channel with the keep-the-first-$2,500 offer.
- Publish the founder's own numbers monthly ("we recovered $X from Y payer for Z clinic") — the content *is* the case study engine.
- Launch **the Dental Underpayment Index**: quarterly, anonymized, by payer — press-worthy, dentist-viral, and impossible to write without our data. This starts the brand as *the payer-accountability company*.
- *Targets:* $8–15k average first-audit recovery; ≥60% of audited practices convert to ongoing monitoring; NPS from "they sent us a check."

### Phase 2 — The subscription (months 9–18): from found money to kept money
- **Recoup Monitor** ($349–599/mo): continuous EOB-vs-contract audit, downgrade/bundling alerts, fee-schedule drift detection, annual renegotiation prep pack (the #11 product, now data-armed).
- First **DSO pilots** (central billing teams love found money; contingency needs no capex approval).
- Verification bundling begins for Monitor subscribers (§4.2) — the price-umbrella attack.
- *Targets:* ≥50% of recovery clients on Monitor; ARPA ≥$500/mo blended; corpus ≥250k adjudications.

### Phase 3 — The platform (months 18–36): payer accountability layer
- Fee benchmarking + payer report cards as data products (practices, consultants, DSO diligence).
- Claims-side expansion **from installed-base strength** — denial prevention informed by the corpus ("this payer denies D2740 without pre-op films 84% of the time"), which is a better denial product than any claims-first competitor can build.
- Optional at this point, not before: raise capital. The corpus + contingency economics + installed base is a fundable story *on our terms*; entering the verification knife-fight pre-revenue was not.

---

## 6. Competitive counters (what they do when this works)

| Threat | Likely move | Our answer |
|---|---|---|
| **Foji/Azops add "underpayment detection"** | Flag variances as a feature | They see EOBs only if they build posting; without contract reconstruction + dispute ops it's a report, not a check. Our head start is the corpus + the collections muscle; push contingency pricing they can't match without gutting SaaS. |
| **Zentist/DSO RCM suites descend** | DSO-tier payment integrity | They're enterprise-bound; we own independents via community + contingency. Speed in the beachhead is the defense; don't dawdle in Phase 1. |
| **Payers harden** | Stall disputes, recoup counterclaims, portal/data friction | Contract rights + state prompt-pay statutes are on our side; dentist-signed disputes escalate credibly; document everything (we already artifact every step). This tax *is* the moat — budget it. |
| **Medical payment-integrity players (Rivet, MD Clarity) cross over** | Add dental module | Dental adjudication quirks (downgrades, frequencies, leased networks) + OpenDental integration + dental distribution are years of specificity; they've ignored dental for a decade because ACVs look small — our model makes small ACVs work, theirs doesn't. |
| **A verification vendor copies the free-audit offer** | Marketing copy | The offer without the recovery engine is a demand-gen stunt that generates disputes they can't work. Let them advertise our category. |

---

## 7. Scorecard (review monthly)

- Recovered $ per practice (first audit; trailing-90-day)
- Recovery → Monitor conversion %; Monitor churn
- Corpus size (adjudications joined to contracts) and payer coverage
- Dispute win rate + median days-to-check (the ops health metric)
- CAC (should stay near zero through Phase 1) and blended ARPA
- Verification-accuracy delta vs. corpus (fuel for §4.3, later)

## 8. What we are explicitly NOT doing

- Not selling verification head-to-head at $499/mo against twelve funded vendors.
- Not building for Dentrix/Eaglesoft before the OpenDental beachhead pays for it.
- Not raising capital to buy a knife for the knife-fight; capital, if ever, buys distribution for a category we already own.
- Not letting the clinic launch and Phase 0 peak in the same month — sequence them; the clinic is the lab, not the competition for attention.
