# Project Notes

Running log of requirements and locked decisions. Newest decisions appended per section.

## What we're building

An agent that closes one finance-ops loop: match a merchant's **expected** order/invoice
records against **actual** Razorpay settlements across a 50+ record batch, report match
rate, and diagnose every unresolved discrepancy in plain language with a confidence score.

**Differentiator:** Razorpay's shipped recon tooling (Optimizer Single View, Bookkeeping
Agent, etc.) either reconciles inside Razorpay's own data or auto-resolves via fixed rules.
Ours explains *why* a discrepancy exists, against the merchant's independent records.

**Deadline:** 2026-09-05. Build window is 2 days (2026-08-27 to 08-28), then 2 days for the
pitch video. Submitting early with buffer, not filling the calendar.

## This is an MVP, and the scope is deliberate

One finance-ops loop, closed properly, with measured accuracy. Not a platform. Judges are
Razorpay engineers, and a small honest thing that works beats a broad thing that half
works — so the cut list below is a design decision, not an apology.

**In scope**
- Real Razorpay Settlements API call (test mode), proving auth and response shape.
- 55-record synthetic expected side, stated as synthetic every time it comes up.
- Agent orchestrating deterministic tools, diagnosing against the 10-cause taxonomy.
- Real computed eval numbers, per cause, including the causes we do badly on.
- Three UI screens: summary, record table, drilldown with the reasoning trail.

**Out of scope, on purpose**
- **Auth, multi-user, persistence.** Single-merchant demo. No accounts to store, so no
  database — a batch runs in memory and results are JSON.
- **Any write-back or manual override.** Read-only by design. An agent that moves money
  needs a much higher bar than a buildathon MVP can honestly claim.
- **Creating payments or forcing settlement cycles.** We read settlements; we do not make
  them.
- **RAG or a vector store for the Q&A box.** The computed report fits in one context
  window. Retrieval infrastructure here would be architecture theatre.
- **Streaming or real-time recon.** Reconciliation is a batch problem. Pretending otherwise
  would be a worse design, not a more impressive one.
- **Multi-currency beyond the FX markup case.**
- **Cross-record pairing exclusion.** Already documented below as the accepted cost of
  per-record isolation.

**Stretch, only if day 2 finishes early:** deploy; the Q&A box (screen 4); three eval runs
for variance instead of one.

**Rule for the prompt-iteration step:** two rounds of fixes, then ship the number that
comes out. A measured 74% with an honest per-cause breakdown is a stronger submission than
a tuned 95%, and cherry-picking is already a hard constraint below.

## Locked decisions

### Money is integer paise, never float rupees
Razorpay's API returns paise as integers; we mirror that. Float arithmetic would
manufacture sub-rupee errors, which is fatal when "rounding drift" is cause #8 in our own
taxonomy — we could never distinguish real drift from float noise. Convert to rupees at
display only.

### Ground truth lives in a separate sidecar file
`generator.py` emits two files: `synthetic_batch.json` (clean records, what the pipeline
sees) and `ground_truth.json` (injected cause per `record_id`, what only `eval.py` reads).
Physically separate so the label cannot leak into the agent's context by accident. Both
committed to the repo for reproducibility.

### Causes are primary + contributing, not single-label
Real discrepancies stack — MDR + GST + rounding is the *normal* case, not three separate
cases. Each record carries `primary_cause` plus a `contributing_causes` list. Eval scores
accuracy on primary cause.

### The agent orchestrates; it does not compute
Superseded the original design, where Python hardcoded exact → fuzzy → LLM and the agent
was just the last pipeline stage. That is a script with an LLM bolted on, and a technical
judge would be right to say so.

Now: the Agno agent has deterministic tools and decides itself which to call, in what
order, and when to stop, based on what each result shows.

| Tool | What it does | Deterministic? |
|---|---|---|
| `try_exact_match` | Match on reference + amount | Yes |
| `try_fuzzy_match` | rapidfuzz on truncated/altered UTRs (cause #9) | Yes |
| `check_arithmetic_causes` | Reconstruct MDR, GST, TDS, rounding; return component evidence + residual (causes #1,2,3,8) | Yes |

The LLM never does arithmetic. Only the *sequencing* is model-driven.

`check_arithmetic_causes` stays one bundled tool, not four. Four tools = four chances to
pick wrong and 4x the round-trips. It returns computed evidence, not a verdict — the agent
does the judging.

### Diagnosis is a terminal action, not a tool
`diagnose_via_reasoning` is **not** a tool and there is no sub-agent. Once the agent judges
the deterministic tools exhausted, it stops calling tools and emits the diagnosis directly
— normal tool-calling termination. Taxonomy lives in its system prompt.

Rejected: exposing diagnosis as a tool. That would be an LLM calling itself, which costs an
extra indirection and is awkward to defend on camera for no gain.

### Causes are a `DiscrepancyCause` enum, not free text
Ten fixed causes with a free-text label would let a typo (`mdr_fee` vs `mdr`) score a
*correct* diagnosis as wrong, silently deflating the headline accuracy number that goes in
the video. Enum lives in `schemas.py` because it is a data shape; `taxonomy.py` will hold
the prompt-facing descriptions keyed off it. No circular import.

### `GroundTruthEntry.settlement_id` records the correct pairing
Lets eval measure **pairing accuracy separately from diagnosis accuracy**. A fuzzy match can
pair record A to settlement B wrongly and still produce a plausible-sounding explanation;
without this field that failure is invisible.

`None` is meaningful ground truth, not missing data — for `in_transit` and `dispute_hold`
the correct answer *is* "no settlement exists yet."

### `is_genuinely_unresolved` is derived, not stored
Now a property returning `primary_cause is UNRESOLVED`. Two fields encoding one fact can
disagree, and then eval has to arbitrate between them.

### Exact match means pairing, not amount equality
Gross ≠ net on *every* healthy transaction, because MDR and GST always come out. If exact
match required amounts to be equal, nothing would ever match. So `try_exact_match` pairs on
reference (UTR ↔ `reference_hint`); accounting for the residual is a separate tool's job.

Consequence: `fees_paise` and `tax_paise` are **given** in the settlement record, so MDR and
GST are directly verifiable. TDS, refunds and FX markup are **not** in the record and must be
inferred from the residual. That split is why the taxonomy layers divide where they do.

### `in_transit` vs `dispute_hold` is a date judgement, not a flag
Both have **no settlement record at all**. In-transit means the order sits inside the T+2
window; dispute-hold means settlement was due days ago and never arrived. Nothing in the
data labels which is which — the agent must reason from the date gap. Deliberate: it tests
reasoning rather than pattern-matching.

### `gst_on_fee` is modelled as a merchant bookkeeping error
Needed a signature that makes GST a *primary* cause rather than a permanent contributor.
The realistic one: the merchant books their expected figure net of MDR but forgets the 18%
GST charged on that fee, so the residual they cannot account for is exactly the tax. The
standard formula then under-predicts net by exactly `fees`, which is a detectable signature.

### Settlements are shuffled before writing
Without it, `settlements[i]` always pairs with `expected_records[i]` and the matcher could
score perfectly by reading index positions instead of matching. Same class of problem as the
answer-key leak.

### Verticals are dealt round-robin, not drawn at random
Uniform random draws over 55 records gave 26/16/13, so per-vertical accuracy would have
rested on as few as 13 samples while we claim the agent holds across all three. Round-robin
then shuffled gives 19/18/18. A self-check asserts the spread stays within 1, so it cannot
silently regress. Costs nothing and makes the multi-vertical claim measurable.

### Generation is seeded and reproducible
`random.Random(42)` as a local instance, not global `random.seed()`, so importing the module
does not perturb anything else's randomness. Eval numbers go in a pitch video; a batch that
changes between runs makes them unquotable.

### Fuzzy matching uses structural tests, not a similarity score
Started with `fuzz.ratio` plus a threshold and a runner-up margin. **Measured it against the
batch and it does not work.** Every UTR shares a `UTR` + date prefix, so:

| | genuine truncation | unrelated same-day settlement |
|---|---|---|
| `fuzz.ratio` | 89.66 | 87.50 |
| runner-up gap | 6.90 | **12.50** |

Only 2.16 points separate a real match from a coincidence, and the runner-up margin is
*inverted* — wider for coincidences than for genuine matches, so the guard actively
mis-ranks. A tuned threshold would also break on the next seed.

What separates cleanly is structure, because it matches the actual corruption modes:

| Test | genuine | coincidental |
|---|---|---|
| UTR starts with the reference | 1 hit | 0 hits |
| edit distance, same length | ≤ 2 | 3–5 |

So: truncation is a **prefix relation**, a garbled digit is a **bounded edit distance**, and
more than one candidate means genuinely ambiguous — report that instead of guessing. Result
is 48/48 correct pairings with zero false positives on the 7 records that have no settlement.

**Named ceiling:** with 5 random digits per UTR, coincidental same-length neighbours sit at
distance 3+ in a 50-record batch. Across millions of settlements they would reach distance 2
and pairing would need the amount as a second signal. Documented in the docstring.

### Statutory rates live in `engine.matcher`; the generator imports them
GST 18%, TDS 1% (s.194-O) and the 3% FX markup are Indian statute, not synthetic-data knobs.
Declared in both files they could drift, and then the matcher's reference amounts would stop
corresponding to what the generator injected — eval accuracy would collapse in a way that
looks like agent failure. Test data depending on domain rules is the right direction; the
reverse would couple the engine to a generator that will not exist in production.

`MDR_RATES` stays local to the generator: those are invented pricing tiers, and the matcher
never needs them because `fees_paise` is given on the settlement record. `DRIFT_PAISE` is
derived from `ROUNDING_TOLERANCE_PAISE` for the same anti-drift reason.

### `try_fuzzy_match` returns a reason, not a score
`(settlement, detail)` where detail is the human-readable basis for the match — "reference is
the first 13 characters of UTR X" — or why none was made. Feeds the audit trail directly, so
the trace explains itself rather than showing a bare number the user cannot interpret.

### No cross-record pairing exclusion, deliberately
Records are reconciled independently so they can fan out concurrently, which means no shared
state and therefore no global guarantee that two records never claim the same settlement. The
ambiguity check catches the within-record case. Honest limitation to state rather than build
distributed claim-tracking for a 55-record batch.

### Trace comes from Agno's tool-call log, not a separate tracer
`tracer.py` is dropped as a module. Agno already records each tool call, so that log *is*
the reasoning path — a parallel logger would be a second source of truth that can disagree
with the first. What survives is a small formatter mapping Agno run events into the
frontend's `trace: [{step, result, detail}]` shape.

### Records are reconciled concurrently
Every record now costs several LLM round-trips (observe → decide → call → observe). At ~55
records that is minutes of wall clock, which kills the demo. Records are independent, so
each gets its own agent run and runs fan out N-at-a-time. Sequential within a record,
parallel across them.

### Eval is reported with variance, not as a single number
A self-directed agent can take different paths on identical input, so precision/recall
varies run to run. Temperature 0, and eval runs 3x reporting mean + spread. Stronger than
one clean figure, because it shows we know an LLM's output is a distribution.

### Eval also scores tool-path efficiency
Second metric the old pipeline design couldn't produce: tool calls per record, and how
often the agent reached the correct cause. This is the direct answer to "how do you know
your agent isn't skipping steps?" — the obvious question about any self-directed agent.

### Guard against runaway loops
Max tool-call iterations per record. On exhaustion the record terminates as `unresolved`
with an honest note. Cause #10 exists precisely so nothing gets force-fitted.

Implemented as Agno's own `tool_call_limit=6`, not a hand-rolled counter. The longest
honest path is three calls (exact, fuzzy, then arithmetic or the date check), so 6 allows
an agent that backtracks once without letting one spin.

### The taxonomy states mechanisms, never the generator's ranges
`agent/taxonomy.py` could say "partial refund means a residual of 10-40% of gross" —
that is literally `rng.uniform(0.10, 0.40)` from the generator. Accuracy would rise and
the number would stop meaning anything, because eval would be scoring how precisely the
answer key was transcribed into the prompt.

Line held: **statutory rates in, invented ranges out.** GST 18%, TDS 1% (s.194-O) and the
3% FX markup are public and a real controller would know them. The MDR tiers, the refund
spread and the unresolved offset stay out. `taxonomy.py` imports nothing from
`data.generator`, which is checkable from its import block.

Consequence, accepted deliberately: `partial_refund` vs `unresolved` is now genuinely
hard, since both are "positive residual, no statutory match." That is the judgement a
human controller actually makes, so it is the right thing to be scored on.

### Tools take no arguments; the record is bound in
The record, the settlement list and the batch date live in a `ContextVar`, so the agent
calls `try_exact_match()` empty. Letting the model pass a UTR or an amount would be a
hallucination surface — one transposed digit pairs a record to the wrong settlement while
every downstream step still looks healthy. Binding the data in makes that impossible
rather than validated against, which also removes a whole "ID not found" error path.

`get_current_record()` raises when nothing is bound instead of returning `None`. A tool
running unbound would not crash, it would answer confidently about the wrong record, which
is the worst failure this project has.

### The bound record is a ContextVar, not a per-record object
`check_arithmetic_causes` needs to know which settlement was paired, so state has to live
between tool calls. It lives on the `RecordContext` the ContextVar holds, and
`set_current_record` returns that object so the caller can read `.matched` back after the
run — which is how `settlement_id` reaches `ReconciledRecord` and how eval scores pairing
accuracy separately from diagnosis accuracy.

This is what lets the tools be plain module-level functions and the agent be a single
module-level object. An earlier version bound the data into a `RecordTools` instance and
built one agent per record; the ContextVar does the same job with no class and no factory.

Safe under fan-out because `asyncio.gather` wraps each coroutine in a `Task`, and a Task
copies the current `Context` at creation — a `set()` inside one run is invisible to the
other 54. `python -m context` asserts exactly that across all 55 records, and asserts
nothing leaks back into the caller's context afterwards.


### Tools report state and never name a cause
Enforced, not just intended: `assert DiscrepancyCause.MDR_FEE.value not in report`. If a
verdict ever creeps into tool output, the tools are doing the diagnosis and the LLM is a
paraphraser, and the agentic claim collapses. Cheap assert on the load-bearing boundary.

### Calling a tool out of order is a real case, so it is handled
The agent owns the sequence, so it can call `check_arithmetic_causes` before pairing
anything. That returns "nothing to reconcile against, match it first" — one clause so it
recovers in a turn. Not defensive code for an impossible case; the case exists *because*
the model has the steering wheel. The prerequisite itself is real domain logic: you cannot
reconcile an amount against a settlement you have not identified.

### NVIDIA DeepSeek Flash is the requested model route
`config.py` uses `OpenAIChat` against NVIDIA's OpenAI-compatible endpoint with the supplied
`deepseek-ai/deepseek-v4-flash-0731` model, `temperature=1`, `top_p=0.95`, 16,384 output
tokens, and NVIDIA's requested thinking settings. `openai==3.5.0` is pinned; the unused
Anthropic SDK is removed.

NVIDIA's endpoint does not promise OpenAI JSON-schema support, so
`supports_native_structured_outputs=False` makes Agno use prompt-enforced `output_schema`.
A malformed answer is still a real path, and `_unreadable()` returns the record as
`unresolved`, confidence 0.0, with the trace intact. Consistent with cause #10: when we
cannot tell, say so.

The account authenticated and listed models, but DeepSeek Flash timed out and NVIDIA then
returned HTTP 402 (budget pool quota exhausted). No agent accuracy numbers are claimed until
that quota is available again.

### Both documented Razorpay API boundaries are live-verified
With the test credentials in `.env`, a read-only call to `GET /v1/settlements/?count=1&skip=0`
authenticated and returned zero settlements. A read-only call to
`GET /v1/settlements/recon/combined?year=2026&month=8&count=1&skip=0` also authenticated and
returned zero items. This is expected for a new test account; the calls prove credentials and
response shape, while the 55-record synthetic batch supplies throughput for the MVP.

### `ReconciledRecord` lives in `data/schemas.py`, `Diagnosis` in the agent
`Diagnosis` (what the model answers) is meaningless without the prompt, so it sits beside
it. `ReconciledRecord` is the API contract read by the report builder, the API and eval —
putting it in schemas.py means formatting a saved result never imports an LLM client.

`status` is a Pydantic `computed_field` derived from `primary_cause`, so the two cannot
disagree. Same reasoning as `is_genuinely_unresolved`. Four values, with `in_transit`
distinct as flagged earlier: lumping "not yet due" into `explained` would muddy the match
rate.

### The prompt is built from `model_dump()`, not by hand
`exclude=True` is a serialisation guard, not an access guard — hand-interpolating
`expected.linked_settlement_id` into a prompt would leak the answer key past it.
`build_prompt` serialises through the model so the exclusion applies structurally, and a
self-check asserts across all 55 records that no pairing appears in its own prompt. The
documented weakness is now an enforced guarantee.

### Confidence is explicitly calibrated in the prompt
Without anchors the model returns 0.95 for everything and the number is decoration. Three
bands tied to evidence: 0.90+ needs an exact arithmetic match, 0.60-0.89 is consistent but
unconfirmed, below 0.60 means answer `unresolved` instead. Eval can then check whether
confidence actually correlates with correctness, which is worth reporting.

### Concurrency is asyncio with a semaphore, not a thread pool
`agent.arun` with `asyncio.Semaphore(8)`. FastAPI is async, so step 6 composes with no
bridging. Eight lines total.

## Hard constraints

- **Never claim integration with Razorpay Agent Studio products** (Bookkeeping Agent,
  Reporting Agent, Receivables Agent). Those are closed merchant-facing products, not
  developer-callable. We use only documented APIs: Settlements + Settlement Recon.
- **The expected side is synthetic, and we say so.** Not a shortcut — even in production
  this comes from the merchant's own external system, not Razorpay's API.
- **Report only computed eval numbers.** No cherry-picked demo record.
- **Smallest thing that satisfies the track card.** "MNC-grade repo" framing was
  explicitly rejected; padded code reads worse to an engineer judge than lean code.

## Discrepancy taxonomy (10 causes)

Resolved by which layer:

| # | Cause | Layer |
|---|---|---|
| 1 | Standard MDR / processing fee | `check_arithmetic_causes` |
| 2 | GST on processing fee (fee + 18%) | `check_arithmetic_causes` |
| 3 | TDS deduction | `check_arithmetic_causes` |
| 4 | Partial refund after original sale | LLM reasoning |
| 5 | Currency conversion markup (cross-border) | LLM reasoning |
| 6 | In-transit / T+2 timing — **not an error** | LLM reasoning |
| 7 | Disputed transaction hold | LLM reasoning |
| 8 | Rounding drift (paise, from stacked fees) | `check_arithmetic_causes` |
| 9 | Reference/UTR mismatch | `try_fuzzy_match` |
| 10 | Genuinely unresolved — flagged honestly | terminal state |

Vertical-specific flavors via `business_type` (ecommerce / saas / bookings): e.g. SaaS
mid-cycle plan upgrade proration, bookings partial cancellation refund. Same engine, one
UI filter — proven across verticals without extra engineering.

## Open questions

- **Frontend: Vite React SPA served by FastAPI.** Decided under the 2-day window. Not
  Streamlit, which reads as a data-science demo for something handling a merchant's money;
  not full Next.js, which means two deploys and a CORS setup for no gain here. A Vite SPA
  behind `StaticFiles` is one deploy, no CORS, and still looks like a product. Three
  screens, built against saved eval JSON so no tokens are spent on UI work.
- **Test-mode settlements are usually empty.** Razorpay test accounts generally have no
  settlement data unless payments were captured *and* a settlement cycle ran. Step 4 may
  legitimately return zero rows. Plan: the live call proves real auth + real endpoint +
  real response shape; synthetic drives the 50+ volume; we state exactly that. Build
  `razorpay_client.py` expecting empty.
- **`anthropic==1.0.0` is a brand-new major.** agno 2.9.0 declares its `anthropic` extra
  unpinned, so there's no resolver conflict, but agno may not be tested against 1.x yet.
  If the first agent run breaks, drop to the last 0.x.
- **`MODEL_ID = "claude-sonnet-5"` is unverified against the live API.** No key on this
  machine yet, so nothing past prompt assembly has run. Agno's own default is
  `claude-sonnet-4-5-20250929`; if the id 404s on the first live run, that is the fallback.
  Everything else in step 3 is checked offline across all 55 records.

## Roadmap

Two build days, front-loaded so the thing that matters lands first. Day 1 ends with real
accuracy numbers, which means a collapsed day 2 still leaves a defensible submission.

**Done**

| # | Step | Status |
|---|---|---|
| 0 | Folder structure + root files | done |
| 1 | `data/schemas.py`, `data/generator.py` | done |
| 2 | `engine/matcher.py` (exact + fuzzy, pure functions) | done |
| 3 | `agent/taxonomy.py`, `agent/tools.py`, `agent/reasoning_agent.py` | done, live run pending a key |

**Day 1 — 2026-08-27, ends with measured accuracy**

| # | Step | Est |
|---|---|---|
| 4 | `engine/razorpay_client.py` (real API, test mode, expect zero rows) | done |
| 5 | `reporting/report_builder.py` | done |
| 6 | First live run, then prompt iteration - 5 records before 55 | 2-3h |
| 7 | `evaluation/eval.py` - real precision/recall, per cause, pairing separate from diagnosis | 1.5h |

**Day 2 — 2026-08-28**

| # | Step | Est |
|---|---|---|
| 8 | `api/main.py` - `POST /run-batch`, `GET /record/{id}` | 45m |
| 9 | `frontend/` - 3 screens, built against saved eval JSON | 3h |
| 10 | README rewrite + architecture walkthrough | 45m |
| — | Stretch: deploy, Q&A box, 3-run variance | — |

**2026-08-29 to 08-30** — pitch video. **Submit 08-31**, five days before the deadline.

### Eval moved ahead of the API and frontend
Was step 9, after deploy. Eval only needs `reconcile_batch`, ground truth and
`ReconciledRecord`, all of which exist after step 5 — and eval is what tells us the prompt
needs work. Discovering that after building a frontend is rework. Running it first also
gives the frontend a real result JSON to build against, so screens cost no tokens.

## Environment

- Pins verified against PyPI 2026-08-24.
- **`python` on PATH is 3.11.15, but `pip` belongs to a 3.12 store install** — installing
  with bare `pip` puts packages where `python` won't see them. Use a venv:
  `python -m venv .venv && source .venv/Scripts/activate`.
- All pinned deps require Python >= 3.10, so either interpreter works once isolated.

## Backend record shape (frontend contract)

```json
{
  "record_id": "string",
  "expected_amount": 0,
  "actual_amount": 0,
  "status": "matched | explained | unresolved",
  "business_type": "ecommerce | saas | bookings",
  "explanation": "string or null",
  "confidence": 0.0,
  "trace": [{"step": "exact_match", "result": "failed", "detail": "string"}]
}
```

Amounts are paise. `status` may gain a distinct value for cause #6 (in-transit), since
"not yet due" isn't an exception and lumping it into `explained` muddies the match rate.

## UI requirements

Tone: calm, clear, confidence-inspiring. This handles a merchant's money — amber/green,
no panic-red "ERROR".

1. **Summary** — match rate % headline, sub-stats (total / matched / needs attention),
   exception category chips, business-type filter. Immediately visible.
2. **Record table** — one row per record: ID, expected, actual, status badge, business type.
   Click → drilldown.
3. **Drilldown** — expected vs actual, dates, references. Reasoning trail as a step
   timeline. Plain-language explanation at top. Unresolved records get a neutral,
   non-alarming message. **This is the screen the video is built around** — it is where the
   differentiator is visible rather than described.
4. **Q&A box** — cut to stretch under the 2-day window. Queries already-computed results,
   not live recomputation. One LLM call with the computed report as context. No RAG, no
   vector store. Dropped first because it demonstrates the least: screens 1-3 already prove
   the agent explains why, and this only adds a way to ask again.

Non-requirements: no auth, no multi-user, no manual override, minimal animation.

### Tool docstrings state capability; the agent's instructions carry the guidance
Same functions, two audiences, which is the whole reason `agent/tools.py` exists rather
than handing Agno the matcher directly. `matcher.try_fuzzy_match` explains to a maintainer
why structural tests beat similarity scores, with the measurements — 300 tokens the model
has no use for. The tool docstring says only what the tool does.

When to reach for each tool sits in `instructions` instead, and is phrased as capability
rather than order: "`check_arithmetic_causes()` only means anything once a settlement is
paired", not "call it third". A prescriptive `first X, then Y` would turn the agent into a
script and the differentiator into a fixed pipeline with an LLM writing the summary.

### One agent object, not one per record
`reconciliation_agent` is a module-level singleton. Agno 2.9.0 keeps per-run state in a
`RunContext` rather than on the `Agent`, and the record itself is in a ContextVar, so
nothing about a run is stored on the shared object. The guard is the pairing assert in
`python -m agent.tools`: if runs contaminated each other, pairings would cross and it would
fail loudly across all 55 records.

### `AgentOS` for observability, no `db`, no `Team`
`playground.py` runs Agno's `AgentOS` so tool calls can be watched live — useful for the
pitch video, since "the agent chose this path" is the claim being made. Deliberately no
`db=`: a batch recon has nothing to persist between sessions, and `SqliteDb` would drag in
`sqlalchemy` for that. `AgentOS` does need `python-multipart`, which is now pinned.

Also no `Team`. 55 records are independent, and splitting matching from diagnosis across
two members would put the tool order back in the routing layer — exactly what the single
agent is meant to own. Verified against agno 2.9.0: `agno.playground` no longer exists,
only `agno.os.AgentOS`.

### The Playground binds one record at import
The tools read from context, so a chat with nothing bound would raise. `playground.py` sets
`PLAYGROUND_RECORD` (index 0) at import, the way a per-user demo would set a default user.
Every chat in the Playground reconciles that one record; change the index to watch another.
Not a product surface - a window onto the agent's tool path.

### NVIDIA DeepSeek Flash is the requested model route
`config.py` uses `OpenAIChat` against NVIDIA's OpenAI-compatible endpoint with
`deepseek-ai/deepseek-v4-flash-0731`, `temperature=1`, `top_p=0.95`, 16,384 output tokens,
and the requested thinking settings. `openai==3.5.0` is pinned; the unused Anthropic SDK is
removed. NVIDIA does not promise OpenAI JSON-schema support, so
`supports_native_structured_outputs=False` keeps `output_schema` prompt-enforced.

The account authenticated and listed models, but DeepSeek Flash timed out and NVIDIA then
returned HTTP 402 (budget pool quota exhausted). No agent accuracy numbers are claimed until
that quota is available again.

### Both documented Razorpay API boundaries are live-verified
Read-only calls with the test credentials authenticated against
`GET /v1/settlements/?count=1&skip=0` and
`GET /v1/settlements/recon/combined?year=2026&month=8&count=1&skip=0`. Both returned zero
items, as expected for test mode. The live calls prove credentials and response shape; the
55-record synthetic batch supplies throughput for the MVP.

### Match rate means reconciled; pair rate means paired
`report_builder.py` reports `match_rate` as the percentage with `matched` or `explained`
status. A settlement ID alone is not enough: a paired-but-unexplained record cannot inflate
the headline. `pair_rate` is the percentage with a settlement ID. `in_transit` is outside
both rates because it is an expected pending state, not a successful match or exception.

### OpenRouter Ling Flash is the current model route
`config.py` uses OpenRouter's OpenAI-compatible endpoint with
`inclusionai/ling-3.0-flash-fin:free`, `temperature=0`, and reasoning enabled. The
credential remains an environment variable named `OPENROUTER_API_KEY`; supplied keys are
never written to repository files.

### NVIDIA tool-calling diagnosis and manual schema validation
The initial NVIDIA DeepSeek Flash route returned a function-registration 404. A direct
NVIDIA request with `deepseek-ai/deepseek-v4-pro-0813` then succeeded, and a minimal Agno
probe with one tool also succeeded. LangGraph was tested against the same model and endpoint
and also called its tool, proving the issue was not the model, the NVIDIA endpoint, or basic
Agno tool calling.

The full reconciliation agent still produced zero tool calls when `output_schema=Diagnosis`
was configured. A tiny Agno agent with one tool reproduced that failure with the schema, while
the four real reconciliation tools worked with a compact prompt when the schema was absent.
The root cause was the interaction between Agno's provider-facing structured-output path and
tool calling on this NVIDIA model, not the long taxonomy prompt or the tools themselves.

The fix is to omit `output_schema` from the Agent, instruct the model to return one JSON
diagnosis after it finishes using tools, and parse that response locally with
`Diagnosis.model_validate`. Raw JSON and fenced JSON are accepted; any parse or validation
failure retains the existing unresolved fallback record.

The first five-record run after the fix produced real traces for all five records: pairing
accuracy 100%, diagnosis accuracy 100%, and zero records without tool calls. It averaged 2.8
calls per record. The model repeated arithmetic evidence on two records and fuzzy evidence on
one record, but made no unbounded loop. Results are saved in
`evaluation/deepseek_pro_manual_schema_results_5.json`.
