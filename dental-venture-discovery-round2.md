# Dental Venture Discovery — Round 2 (Constrained Re-run)

**Date:** July 2026
**Companion to:** [`dental-venture-discovery.md`](dental-venture-discovery.md) (Round 1)
**New hard constraint:** *No funded direct competitor may exist.* A candidate is disqualified if any institutionally-funded company's **core product** is the same as the candidate's wedge, in the same (US dental) market. Services firms, bootstrapped legacy software, and funded companies in *adjacent* categories do not disqualify — they get weighed in scoring like any other competitive fact.

**Why this run exists:** Round 1 optimized for value creation and treated funded competitors as market validation; its winner (AI insurance verification) sits in a lane occupied by Zuub, Verrific, Vyne, and (in Canada) Cleer. The founder asked the fair question: wasn't the point to find something *separate*? This run answers it properly — same committee, same scoring rubric, same hostile-investor stage, one added constraint — rather than by vibes. Both runs' winners are compared honestly at the end.

---

## Stage 4R — Eligibility audit and re-scoring

### Constraint audit of the Round 1 top ten

| Idea | Funded direct competitor? | Verdict |
|---|---|---|
| #1 Insurance verification agent | Zuub, Verrific, Vyne Dental; Cleer (Canada); Pearl moving down-stack | **EXCLUDED** |
| #2 AR & denial-recovery agent | Zentist (funded, dental claims/remit automation for DSOs); adjacent AI-RCM entrants | **EXCLUDED** (strict reading) |
| #4 EOB auto-posting | Feature of the same funded stack (Vyne, Zentist) | **EXCLUDED** |
| #5 Underpayment detection (payment integrity) | Medical analogs exist (Rivet, MD Clarity) but **no funded dental-specific product** | **ELIGIBLE** |
| #9 Dental-to-medical cross-coding | Nierman (bootstrapped legacy), consultants/services — no funded software direct | **ELIGIBLE** |
| #10 Credentialing automation | Medallion/Verifiable are funded horizontal-healthcare; dental is on their menu | **EXCLUDED** (borderline, ruled against) |
| #11 PPO negotiation & payer-mix | Consultancies (Unlock the PPO, Veritas — services, unfunded) | **ELIGIBLE** |
| #17 Treatment reactivation | Funded comms incumbents (Weave, NexHealth, Dental Intelligence) own the surface; AI schedulers converging | **EXCLUDED** |
| #48 Referral exchange | Corpses, not competitors | **ELIGIBLE** |
| #75 De novo clinic-in-a-box | Consultants only | **ELIGIBLE** |

### Resurrections
Candidates killed in Stage 3 for reasons **other than** funded competition, restored because this run's premise accepts demand risk in exchange for separateness:

- **#14 Medicaid dental RCM** (killed for customer economics) — no funded dental-Medicaid software exists.
- **#55 Payer-portal automation infrastructure** (killed for anchor-customer risk) — no funded dental-specific infra player.
- **#68 Documentation-defensibility audit** (killed for channel/timing) — nobody funded is doing it.

### Scores (same rubric and weights as Round 1)

Weights: Pain 15% · WTP 15% · Defensibility 15% · Founder-market fit 15% · Frequency 10% · Validation 10% · AI leverage 10% · ARR 10%.

| Idea | Pain | Freq | WTP | Def. | FMF | Valid. | AI | ARR | **Weighted** |
|---|---|---|---|---|---|---|---|---|---|
| **#5 Underpayment detection** | 6 | 7 | 7 | 7 | 8 | 9 | 7 | 5 | **7.00** |
| **#11 PPO negotiation & payer-mix** | 8 | 4 | 8 | 6 | 8 | 7 | 7 | 6 | **6.90** |
| **#9 Cross-coding platform** | 7 | 5 | 8 | 8 | 7 | 6 | 7 | 5 | **6.80** |
| **#75 Clinic-in-a-box** | 7 | 3 | 7 | 5 | 10 | 8 | 6 | 4 | **6.45** |
| **#48 Referral exchange** | 6 | 6 | 5 | 8 | 8 | 5 | 6 | 7 | **6.45** |
| **#55 Portal infra ("Plaid for payers")** | 7 | 8 | 6 | 7 | 6 | 4 | 8 | 6 | **6.35** |
| **#68 Documentation defensibility** | 5 | 5 | 5 | 7 | 8 | 6 | 8 | 4 | **5.90** |
| **#14 Medicaid dental RCM** | 7 | 8 | 4 | 7 | 5 | 5 | 7 | 5 | **5.95** |

**Committee observation before the hostile round:** #5 and #11 are not really two companies. Underpayment detection (continuous, contingency-priced, machine-driven) and PPO negotiation/payer-mix analytics (episodic, high-ticket, data-driven) consume the **same data asset** — contracted fee schedules joined to actual EOB adjudications — and sell to the same buyer about the same enemy. Round 1 killed #5 as "a feature of #2" and #11 as "a subscription that decays into a report." Each is the answer to the other's kill. They are scored separately above but advance to the hostile round as one combined candidate: **the payer-economics platform** (wedge: underpayment recovery; expansion: fee intelligence and negotiation).

---

## Stage 5R — Hostile round

### #14 Medicaid dental RCM — KILLED
The constraint changed; the customer didn't. Safety-net clinics and Medicaid-heavy pedo groups run 2–4% margins and treat software as a cost to be minimized. Fifty state rule-sets fragment the build; audit exposure adds tail risk; WTP is structurally capped by the payer mix. Being alone in a market nobody serves profitably is not a moat, it is the market's verdict.

### #68 Documentation defensibility — KILLED
The buyer feels the pain only after the board complaint, which is too late to sell prevention. Selling proactively requires scaring dentists at scale — an expensive, slow, brand-corrosive funnel. The insurer channel (malpractice carriers subsidizing it) is real but is a 12–24 month enterprise dance a bootstrapped founder can't survive. Separate, yes. Sellable, no.

### #55 Payer-portal infrastructure — KILLED
The natural customers are the funded verification/RCM companies — i.e., this constraint's excluded list becomes your sales pipeline, and they treat portal automation as core IP they will not outsource to a startup that could forward-integrate. Selling to DSOs directly turns it into an applications business wearing an infrastructure costume. The founder also has no infra-sales unfair advantage. Dead.

### #48 Referral exchange — KILLED (again)
Nothing about the new constraint fixes the two-sided cold start, the free-and-habitual fax, or the single-metro foothold. It was separate in Round 1 too; separateness was never its problem.

### #75 Clinic-in-a-box — KILLED (again)
Perfect founder fit, ~5k transactions/year, customers churn by succeeding, real revenue is vendor lead-gen. The ceiling didn't move.

### #9 Cross-coding platform — SURVIVES to the final (bloodied)
**Attack:** every claim is combat with a medical payer that considers dentists out-of-network by default; the committed customer base is maybe 8–10k practices; Nierman's ecosystem owns the believers; onboarding requires teaching dentists medical documentation. This is a $3–5M lifestyle software business being flattered.
**Why it survives anyway:** highest defensibility score in either run's RCM cluster (medical-payer rules + clinical documentation logic is genuinely hard); WTP is strong ($500–1,500/mo) because each sleep appliance case is worth $2–4k in medical reimbursement; AI collapses its worst cost (documentation and prior-auth drafting); and the founder is a clinician, which this niche uniquely rewards.

### #5+#11 Payer-economics platform — SURVIVES to the final
**Attack (the committee's best shots):**
1. *"Round 1 already ruled this a feature."* — As a standalone detector, yes. The candidate here is the combined platform: recovery is the self-funding wedge, the fee-schedule/EOB data asset is the company. The Round 1 kill argument does not address the combination.
2. *"Contingency revenue decays after the backlog."* — True per practice: the historical audit is a one-time bolus, ongoing leakage is $500–2,000/mo/practice. Mitigation is the product ladder — recovery converts into the $300–600/mo intelligence subscription (continuous audit, fee benchmarking vs. anonymized cohort, payer-mix modeling, renegotiation prep) whose value does *not* decay because payers re-offend annually.
3. *"Payers respond."* — They reprocess, reclassify "processing policies," and stall. This is the adversarial tax — and, as in Round 1, it is also the moat: accumulated payer-behavior evidence compounds and repels casual entrants.
4. *"The data cold start killed fee benchmarking (#59) in Round 1."* — It killed benchmarking *as an entry point*. Here the wedge collects the data automatically: every connected practice's EOBs and fee schedules flow in as a by-product of recovery. The cold-start problem is solved by the business model rather than by capital.
5. *"Practices don't know they're underpaid, so who buys?"* — Exactly why the pitch works: "connect OpenDental read-only; we'll show you what payers owe you; pay us only from what we recover" is a zero-risk, zero-behavior-change offer. The demo is the customer's own money.
**Verdict:** survives with the strongest wedge economics of any candidate in either run for a capital-constrained founder.

---

## Stage 6R/7R — The Round 2 winner

## Winner: The Payer-Economics Platform for Dental Practices
### (wedge: contingency underpayment recovery · company: fee-schedule & payer intelligence)

*Working name: "Recoup." The dental instance of the category Rivet and MD Clarity proved in medical — which does not exist in dental as a funded product.*

**Elevator pitch.** "Dental insurers quietly pay below their own contracts — downgrades misapplied, bundling, leased-network 'silent PPO' rates, fee-schedule errors. No practice audits this because comparing every EOB line to the right contract is impossible by hand. Recoup connects to OpenDental read-only, rebuilds your true contracted fee schedules, audits every adjudication against them, and recovers the difference — you pay a percentage of what we collect. The same data then powers the questions every owner asks blind today: are my fees right, which PPOs should I renegotiate or drop, and what is my real reimbursement per hour by payer."

**Runner-up:** cross-coding platform (#9) — a genuinely defensible, genuinely separate business whose honest ceiling (~$5M ARR) makes it the better *lifestyle* choice and the worse *venture* choice.

**Why this founder:** same unfair advantages as Round 1 — OpenDental fluency (claims, EOBs, and fee schedules are all in tables he can already read), a clinic supplying its own historical EOB corpus as the development dataset, clinical credibility when disputing downgrades, and zero-CAC access to the OpenDental community channel.

**First 10 customers:** identical channel to Round 1 (own clinic → study club → OpenDental community → Dentaltown), with an even easier ask: "let us run a free audit of your last 12 months; you keep everything we find in the first $2,500."

**Pricing:** 25–30% of recovered dollars (wedge); $349–599/mo intelligence subscription (year 1+); renegotiation-prep package $2–4k per payer event. Blended ARPA target ≈ $500–800/mo equivalent.

**MVP (8–10 weeks, and it reuses the NightShift build):** the connector, canonical schema, artifact store, job runner, and extraction pipeline built for the Round 1 prototype are directly reusable — swap the input from portal captures to ERA/EOB documents and add the contract/fee-schedule reconstruction module and a dispute-letter generator. The prototype work is a shared substrate, not sunk cost.

**Risks (honest):** ACV ceiling if the intelligence subscription doesn't convert (the wedge alone is a $2–5M business); payers hardening remittance data against audit; recovery attribution disputes; and the same expansion pressure as Round 1 — at scale, the natural adjacency is claims automation, which re-enters the contested lane this run was designed to avoid.

**ARR path:** $10M ≈ 1,400 practices at $600/mo blended (recovery take + subscription). $50M requires the DSO tier (central RCM teams love found money) plus the negotiation/benchmark data products. $100M honestly requires either the claims-automation adjacency (contested) or becoming the pricing-data layer payers and DSOs both buy (uncontested but slower). The ceiling arrives later than Round 1's winner and the early revenue arrives sooner.

---

## The real decision (committee's closing memo)

| | **Round 1: Verification agent** | **Round 2: Payer-economics platform** |
|---|---|---|
| Market risk | Low — budget line proven by competitors | Medium — category doesn't exist in dental yet |
| Competitive risk | High — 3+ funded directs | Low — none funded, dental-specific |
| First-dollar speed | 60–90 days (replace an existing spend) | 30–60 days (contingency = free to try) |
| Revenue quality | Recurring SaaS from day one | Contingency first, subscription must be earned |
| Moat mechanism | Payer-behavior corpus + PMS writeback + EOB feedback loop | Contract/EOB data asset + adversarial payer expertise |
| Ceiling | $100M+ (proven comps in vertical RCM) | $50M clean; $100M requires re-entering contested space |
| Failure mode | Outspent by a funded rival before depth wins | Wedge stays a feature; subscription never converts |

Two coherent bets. Round 1 pays competitive risk for market certainty; Round 2 pays demand risk for an empty lane. The committee's honest synthesis: **they share ~70% of their infrastructure and 100% of their buyer**, and the strongest version of this company may be sequencing — enter with Round 2's uncontested, self-funding wedge; earn the data and the trust; add verification/claims capabilities later from a position of installed-base strength rather than as the fourth funded entrant's cheaper rival. That sequencing was outside both runs' rules. It is what the committee would actually do with this founder's constraints.
