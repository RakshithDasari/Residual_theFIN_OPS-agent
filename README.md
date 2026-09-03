# Residual — Settlement Reconciliation Agent

> Live: **[residual-thefin-ops-agent-ljb9.onrender.com](https://residual-thefin-ops-agent-ljb9.onrender.com)**

---

## What is this and why does it exist

Every merchant using Razorpay has two ledgers that should agree with each other. One is their own order system — what they *expected* to receive. The other is Razorpay's settlement report — what was *actually transferred*. In practice these two numbers almost never match, because Razorpay deducts processing fees, GST on those fees, TDS under section 194-O, and occasionally holds amounts for disputes or FX conversion.

Reconciling these two ledgers manually — at scale, across thousands of orders, every settlement cycle — is genuinely tedious and error-prone. A finance team member has to open two spreadsheets, match rows by UTR reference, compute whether the difference is explained by a known deduction, and decide which ones need escalation. The goal of this project is to automate that entirely: match the records, explain the gaps with evidence, and surface only the ones that actually need a human.

That's Residual. It takes both ledgers, reconciles them, explains every discrepancy in plain English, and gives the finance team a clear picture of what's clean, what's explainable, and what actually needs attention.

---

## The idea in one paragraph

A deterministic engine matches merchant orders to Razorpay settlements using UTR references, then arithmetically decomposes any gap into known causes (processing fee, GST, TDS, FX markup, partial refund, rounding). An LLM sits on top of this — not to do the math, but to explain the result in two sentences a finance team can read and act on. The deterministic layer handles correctness; the model handles communication. Neither substitutes for the other.

---

## What's in this MVP

The MVP reconciles a batch of 55 synthetic records across three business types (ecommerce, SaaS, bookings) and eight discrepancy causes. It demonstrates the full end-to-end workflow:

- Batch reconciliation via the deterministic engine (runs in milliseconds, 100% accurate on this batch)
- Per-record LLM explanations on demand (`/record/{id}?live=true`)
- A conversational agent ("Reya") that answers questions about the batch in plain English
- Four frontend views: a reconciliation stream, a records table, a dual-ledger side-by-side, and a chat interface
- CSV export of the full reconciled batch
- Accuracy metrics scored against held-back ground truth labels

The synthetic data mimics the structure of real Razorpay settlement exports and merchant order records exactly — same fields, same arithmetic, same edge cases. Swapping it for a real data feed requires changing two functions, not the architecture.

---

## How this works in production (where there's no synthetic data)

In a real deployment, Residual sits between two live data sources:

```
Merchant order system  ──────────────────────────────────────┐
  (webhook or API pull)                                        │
  POST /ingest/expected                                        ▼
                                              ┌─────────────────────────┐
                                              │   Residual backend       │
                                              │                          │
  Razorpay settlement API  ─────────────────►│   reconcile + explain    │
  (webhook or polling via                     │                          │
  /v1/settlements + /recon)                   └─────────────────────────┘
  POST /ingest/settlements                               │
                                                         ▼
                                              Dashboard / CSV / Chat
```

The merchant's order system would push expected records to a `/ingest/expected` endpoint — either via webhook on order creation or a periodic API pull. Razorpay's settlement webhooks (or the `/v1/settlements` + `/v1/settlements/{id}/recon` APIs) would feed the actual settlement side to `/ingest/settlements`.

In the MVP, since we don't have live access to either, those two endpoints are replaced by two JSON files: `data/synthetic_batch.json` holds both sides of the ledger in the exact same schema the real endpoints would produce. The reconciliation engine, the agent, and the entire API are production-ready — the only thing that changes between the MVP and a real deployment is where the data comes from.

The engine itself is stateless and batch-shaped by design. In production you'd run it on a schedule (every settlement cycle, typically T+2) or trigger it on incoming webhook events. The results would be stored in a database rather than recomputed from JSON on every request.

---

## The reconciliation pipeline

Here's what actually happens when a batch runs:

```
┌──────────────────────────────────────────────────────────────────────┐
│                      RECONCILIATION PIPELINE                         │
│                                                                      │
│  ExpectedRecord[]          SettlementRecord[]                        │
│  (merchant ledger)         (Razorpay ledger)                         │
│        │                         │                                   │
│        └──────────┬──────────────┘                                   │
│                   ▼                                                  │
│         ┌─────────────────┐                                          │
│         │  try_exact_match │  UTR == reference_hint?                 │
│         └────────┬────────┘                                          │
│            found │         not found                                 │
│                  │              ▼                                    │
│                  │   ┌──────────────────┐                            │
│                  │   │  try_fuzzy_match  │  truncation or            │
│                  │   └────────┬─────────┘  ≤2 char edits?           │
│                  │       found│    not found                         │
│                  │            │         ▼                            │
│                  │            │   ┌──────────────────────┐           │
│                  │            │   │ days_awaiting_settle  │           │
│                  │            │   └──────────┬───────────┘           │
│                  │            │              │                        │
│                  │            │    ≤2d: IN_TRANSIT                   │
│                  │            │    >2d: DISPUTE_HOLD                 │
│                  ▼            ▼                                      │
│         ┌───────────────────────────┐                                │
│         │  check_arithmetic_causes  │                                │
│         │                           │                                │
│         │  residual = predicted_net │                                │
│         │          - actual_settled │                                │
│         └─────────────┬─────────────┘                               │
│                       ▼                                              │
│         ┌─────────────────────────────────────────┐                 │
│         │           CLASSIFY                       │                 │
│         │                                          │                 │
│         │  residual == 0          → MDR_FEE        │                 │
│         │  residual ≈ -fees       → GST_ON_FEE     │                 │
│         │  residual ≈ gross×1%    → TDS            │                 │
│         │  residual ≈ gross×3%    → FX_MARKUP      │                 │
│         │  |residual| ≤ 2 paise   → ROUNDING_DRIFT │                 │
│         │  residual ≥ 10% gross   → PARTIAL_REFUND │                 │
│         │  else                   → UNRESOLVED     │                 │
│         └─────────────┬───────────────────────────┘                 │
│                       ▼                                              │
│              ReconciledRecord                                        │
│              {cause, confidence, explanation, trace}                 │
└──────────────────────────────────────────────────────────────────────┘
```

This runs in milliseconds for 55 records. No model is consulted here. The explanation text is generated by `reporting/narrative.py` — plain template-based prose per cause, fast and reliable. The LLM is an optional layer on top that rewrites this into something more conversational.

---

## The agentic architecture

The LLM agent runs one record at a time, on demand — either when `/record/{id}?live=true` is called, or when the chat agent needs to explain something in detail.

```
┌─────────────────────────────────────────────────────────────────────┐
│                      AGENT ARCHITECTURE                              │
│                                                                      │
│  ExpectedRecord + Settlements                                        │
│          │                                                           │
│          ▼                                                           │
│  ┌───────────────────┐                                               │
│  │  prepare_evidence  │  ← deterministic pre-pass                    │
│  │                   │    runs all 4 tools before                    │
│  │  try_exact_match  │    the model is consulted                     │
│  │  try_fuzzy_match  │                                               │
│  │  check_arithmetic │                                               │
│  │  days_awaiting    │                                               │
│  └────────┬──────────┘                                               │
│           │  evidence strings + trace steps                          │
│           ▼                                                          │
│  ┌─────────────────────────────────────────────┐                    │
│  │  PROMPT                                      │                    │
│  │                                              │                    │
│  │  "Reconcile this record.                     │                    │
│  │   {record fields}                            │                    │
│  │                                              │                    │
│  │   Deterministic evidence already collected:  │                    │
│  │   {exact match result}                       │                    │
│  │   {arithmetic breakdown}                     │                    │
│  │   {days awaiting}                            │                    │
│  │                                              │                    │
│  │   Taxonomy: [10 causes with signatures]      │                    │
│  │   Write: primary_cause / explanation /       │                    │
│  │          contributing_causes / confidence"   │                    │
│  └────────┬────────────────────────────────────┘                    │
│           │                                                          │
│           ▼                                                          │
│  ┌─────────────────────────────────────────────┐                    │
│  │  GLM-5.3-Flash (via HuggingFace router)      │                    │
│  │  temperature=0, top_p=0.95                   │                    │
│  │  tool_call_limit=6                           │                    │
│  └────────┬────────────────────────────────────┘                    │
│           │  4-line labelled response                                │
│           ▼                                                          │
│  ┌─────────────────────────────────────────────┐                    │
│  │  parse_diagnosis()                           │                    │
│  │                                              │                    │
│  │  tries: labelled lines                       │                    │
│  │         labelled lines with **bold**         │                    │
│  │         fenced JSON                          │                    │
│  │         bare JSON                            │                    │
│  └────────┬────────────────────────────────────┘                    │
│           │                                                          │
│           ▼                                                          │
│  ┌─────────────────────────────────────────────┐                    │
│  │  primary_cause  ← classify_evidence()        │ ← ALWAYS           │
│  │                   (deterministic)            │   deterministic    │
│  │  explanation    ← model output               │                    │
│  │  confidence     ← model output               │                    │
│  │                                              │                    │
│  │  if parse fails → template explanation       │                    │
│  └──────────────────────────────────────────────┘                   │
│                                                                      │
│  KEY DESIGN DECISION:                                                │
│  The model NEVER sets primary_cause. classify_evidence() does.      │
│  A bad model response can only affect the explanation text,         │
│  not the classification or the accuracy metrics.                    │
└─────────────────────────────────────────────────────────────────────┘
```

Why this design? The first version let the model do everything — choose which tools to call, run its own arithmetic, name the cause. It reached 45.5% pairing accuracy and 36.4% diagnosis accuracy. Terrible. The core problem was that the model was being asked to do things it's not reliable at (arithmetic, structured classification) when those things are trivially correct as code. Once the architecture separated "gathering evidence" (code) from "explaining evidence" (model), accuracy hit 100%.

---

## The chat agent ("Reya")

The `/query` endpoint powers a conversational layer on top of the batch. The model receives the full reconciled batch as context (one line per record: id, type, expected, settled, diff, status, cause, explanation) plus the conversation history, and answers as "Reya" — a personal accountant who has already seen all the numbers.

```
┌────────────────────────────────────────────────────────────┐
│                   CHAT ARCHITECTURE                         │
│                                                             │
│  User: "why didn't ORD-1000 settle in full?"               │
│          │                                                  │
│          ▼                                                  │
│  POST /query                                                │
│  { query, history: [{role, content}, ...] }                │
│          │                                                  │
│          ▼                                                  │
│  reconcile_batch_deterministic()   ← full batch runs first  │
│  (55 records, <50ms)                                        │
│          │                                                  │
│          ▼                                                  │
│  System prompt:                                             │
│  - "You are Reya, a personal accountant..."                 │
│  - Full batch summary (matched/explained/unresolved)        │
│  - All 55 records as compact table                          │
│  - Records needing attention highlighted                    │
│  - Rules for when to emit structured JSON payloads          │
│          │                                                  │
│  + History of prior turns (memory across session)          │
│  + Current user question                                    │
│          │                                                  │
│          ▼                                                  │
│  GLM-5.3-Flash response                                     │
│          │                                                  │
│          ▼                                                  │
│  Parse |||JSON|||...|||END||| blocks (optional)             │
│  → type: "records"      → records table in UI              │
│  → type: "summary"      → KPI strip in UI                  │
│  → type: "record_detail"→ detail card in UI                │
│          │                                                  │
│          ▼                                                  │
│  { answer: text, ui: {type, rows/data} }                   │
│          │                                                  │
│          ▼                                                  │
│  Chat bubble + rendered UI element                          │
└────────────────────────────────────────────────────────────┘
```

If the model is unavailable (no API key, rate limit, timeout), the system falls back to a keyword router that handles the most common questions ("attention", "unresolved", "transit", "summary") deterministically. The chat never just breaks.

---

## Full application architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        FULL SYSTEM ARCHITECTURE                          │
│                                                                          │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │                        FRONTEND (Vite + React)                    │  │
│   │                   residual-thefin-ops-agent-ljb9.onrender.com     │  │
│   │                                                                   │  │
│   │   /              LandingPage    scroll-reveal, CountUp, Spotlight │  │
│   │   /app           AgentStream    animated pipeline + transcript    │  │
│   │   /app/records   RecordsPage    sortable/filterable table + CSV   │  │
│   │   /app/chat      ChatPage       Reya chat agent, UI cards         │  │
│   │   /app/ledger    LedgerPage     dual-panel side-by-side ledger    │  │
│   │                                                                   │  │
│   │   src/api.js  ──── all backend calls ──► VITE_API_URL             │  │
│   └──────────────────────────────────────────────────────────────────┘  │
│                              │                                           │
│                              │ HTTP (CORS)                               │
│                              ▼                                           │
│   ┌──────────────────────────────────────────────────────────────────┐  │
│   │                  BACKEND (FastAPI + uvicorn)                      │  │
│   │               residual-thefin-ops-agent.onrender.com             │  │
│   │                                                                   │  │
│   │   GET  /health          liveness check                            │  │
│   │   GET  /batch           deterministic reconciliation              │  │
│   │   GET  /batch.csv       CSV export                                │  │
│   │   GET  /record/{id}     single record (det. or live)             │  │
│   │   POST /query           chat agent                                │  │
│   │                                                                   │  │
│   │   backend/service.py ──► engine/reconciler.py                    │  │
│   │                      ──► agent/reasoning_agent.py (on demand)    │  │
│   │                      ──► reporting/                              │  │
│   │                      ──► evaluation/eval.py                      │  │
│   └──────────────────────────────────────────────────────────────────┘  │
│          │                          │                                    │
│          │                          │ model.response()                   │
│          ▼                          ▼                                    │
│   ┌─────────────┐         ┌─────────────────────────┐                   │
│   │ data/       │         │  HuggingFace router      │                   │
│   │             │         │  router.huggingface.co   │                   │
│   │ synthetic_  │         │  /v1 (OpenAI-compatible)  │                  │
│   │ batch.json  │         │  zai-org/GLM-5.3-Flash   │                   │
│   │ ground_     │         └─────────────────────────┘                   │
│   │ truth.json  │                                                        │
│   └─────────────┘                                                        │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## Production architecture (no synthetic data)

In production, the two JSON files are replaced by live data feeds:

```
┌────────────────────────────────────────────────────────────────────────┐
│                     PRODUCTION ARCHITECTURE                             │
│                                                                         │
│  Merchant ERP / Order System                                            │
│  ┌──────────────────────┐                                               │
│  │  Order created event  │──── webhook ────► POST /ingest/expected     │
│  │  (id, amount, ref)    │                                              │
│  └──────────────────────┘                                               │
│                                                                         │
│  Razorpay                                                               │
│  ┌──────────────────────┐                                               │
│  │  Settlement webhook   │──── webhook ────► POST /ingest/settlements  │
│  │  OR                   │                                              │
│  │  GET /v1/settlements  │◄─── polling ──── scheduler (T+2 cycle)      │
│  │  GET /v1/settlements/ │                                              │
│  │       {id}/recon      │                                              │
│  └──────────────────────┘                                               │
│                                │                                        │
│                                ▼                                        │
│                    ┌───────────────────────┐                            │
│                    │  Database             │                            │
│                    │  expected_records     │                            │
│                    │  settlement_records   │                            │
│                    │  reconciled_results   │                            │
│                    └──────────┬────────────┘                           │
│                               │                                         │
│                               ▼                                         │
│                    ┌───────────────────────┐                            │
│                    │  Reconciliation engine │  ← same code, new        │
│                    │  (same logic, load     │    data source            │
│                    │   from DB not JSON)    │                            │
│                    └──────────┬────────────┘                           │
│                               │                                         │
│                               ▼                                         │
│              Dashboard / Alerts / CSV / Chat                            │
└────────────────────────────────────────────────────────────────────────┘
```

What stays the same: the entire reconciliation engine, the agent, the API, the frontend.
What changes: `load_batch()` reads from a database instead of JSON. Two new ingest endpoints. A scheduler triggers reconciliation runs. Results are persisted rather than recomputed on every request.

---

## Challenges faced and how accuracy improved

**The first version was a mess.** The initial architecture gave the model full autonomy — it decided which tools to call, in what order, whether to call them at all, and then named the cause itself. On 55 records: 45.5% pairing accuracy, 36.4% diagnosis accuracy. It felt confident and was mostly wrong.

**Two bugs the logs didn't show.** The HuggingFace router was rejecting a `developer` role that Agno was inserting into the message list (the router only accepts `system`, `user`, `assistant`). Agno's auto-generated tool JSON Schema included an invalid `additionalProperties: false` catch-all field that made strict validators reject every tool call silently. Neither of these raised an exception — the model just got bad input and returned garbage.

**The architectural fix.** The solution was to stop asking the model to do things code can do reliably. The reconciliation engine now gathers all evidence deterministically before the model is ever consulted. The model receives a prompt that already contains the matching result, the arithmetic breakdown, and the days-awaiting figure. Its job is exactly one thing: write a clear explanation. Cause classification, pairing, and arithmetic are always done by code. After this change: 100% pairing accuracy, 100% diagnosis accuracy.

**What this means for the agent design.** The model never sets `primary_cause` in the final output — `classify_evidence()` always does that. A bad model response can degrade the explanation quality but cannot change the cause classification or break the accuracy metrics. This is the key design decision: correctness is guaranteed by determinism; the model handles only communication.

**Remaining limitations:**
- The fuzzy matcher uses structural heuristics (prefix truncation + Levenshtein distance). Over millions of settlements with many same-day UTRs, two records could coincidentally be within edit distance 2 of each other — the amount would need to serve as a second signal.
- The partial refund detection (≥10% of gross with no other explanation) is a heuristic. A real deployment would need the merchant's refund records as a third data source to confirm.
- `UNRESOLVED` is the honest answer when no cause fits. There are 2 unresolved records in this batch. In production, these would be routed to a human review queue automatically.
- The chat agent re-runs the full batch on every `/query` call. In production this would be cached.

---

## Running locally

**Prerequisites:** Python 3.11+, Node 18+, a HuggingFace token.

```bash
# Clone
git clone https://github.com/RakshithDasari/Residual_theFIN_OPS-agent.git
cd Residual_theFIN_OPS-agent

# Backend
cp .env.example .env
# Edit .env and set HF_TOKEN=your_token

python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # Mac/Linux

pip install -r requirements.txt
uvicorn backend.main:app --port 8001

# Frontend (separate terminal)
cd frontend
npm install
# Create frontend/.env.local with:
# VITE_API_URL=http://localhost:8001
npm run dev
```

Open `http://localhost:5173`. Backend health check: `http://localhost:8001/health`.

**To run the deterministic engine directly:**
```bash
python -m engine.reconciler
```

**To run the evaluation:**
```bash
python -m evaluation.eval
```

---

## Live deployment

| Service | URL |
|---|---|
| Frontend (Render Static Site) | https://residual-thefin-ops-agent-ljb9.onrender.com |
| Backend (Render Web Service) | https://residual-thefin-ops-agent.onrender.com |
| Backend health check | https://residual-thefin-ops-agent.onrender.com/health |
| Batch API | https://residual-thefin-ops-agent.onrender.com/batch |

---

## Project structure

```
.
├── backend/
│   ├── main.py          FastAPI routes and CORS config
│   └── service.py       Service layer: batch, single record, chat agent
│
├── engine/
│   ├── matcher.py       Exact match, fuzzy match, arithmetic evidence
│   ├── reconciler.py    Deterministic batch reconciliation + classification
│   └── razorpay_client.py  Live Razorpay API client (for production use)
│
├── agent/
│   ├── reasoning_agent.py  LLM agent, evidence-first design, parse_diagnosis
│   ├── tools.py            4 tool wrappers (read evidence via ContextVar)
│   └── taxonomy.py         10-cause classification taxonomy
│
├── data/
│   ├── schemas.py          Pydantic models for all record types
│   ├── generator.py        Synthetic batch generator (seed=42)
│   ├── synthetic_batch.json  55 expected + 48 settlements
│   └── ground_truth.json   Answer key (never seen by the engine)
│
├── reporting/
│   ├── narrative.py        Plain-English explanation templates per cause
│   ├── report_builder.py   Summary stats computation
│   └── csv_export.py       14-column CSV with CRLF (Excel-compatible)
│
├── evaluation/
│   ├── eval.py             Scoring: pairing accuracy, diagnosis accuracy
│   └── challenge_eval.py   20-record harder evaluation set
│
├── frontend/
│   └── src/
│       ├── api.js           All backend calls, formatters, constants
│       ├── agentScript.js   Animated pipeline playback from real data
│       ├── pages/
│       │   ├── LandingPage.jsx
│       │   ├── AgentStream.jsx   Animated reconciliation run
│       │   ├── RecordsPage.jsx   Filterable/sortable table
│       │   ├── ChatPage.jsx      Reya chat interface
│       │   └── LedgerPage.jsx    Dual-panel ledger view
│       └── components/
│           ├── RecordDrawer.jsx  Full record detail + trace
│           ├── BlurText.jsx      Scroll-reveal text animation
│           ├── CountUp.jsx       Animated number counter
│           └── SpotlightCard.jsx Cursor-tracking glow card
│
├── config.py        Model singleton, env var loading, paths
├── context.py       ContextVar for per-record tool isolation
├── requirements.txt Pinned Python dependencies
└── render.yaml      Render deployment config
```

---

## Stack

| Layer | Tech |
|---|---|
| Backend | Python 3.11, FastAPI, uvicorn |
| Agent framework | Agno 2.9.0 |
| LLM | GLM-5.3-Flash via HuggingFace OpenAI-compatible router |
| Fuzzy matching | rapidfuzz (Levenshtein) |
| Frontend | React 19, Vite 8, React Router 7 |
| Animations | motion/react (CountUp, BlurText) |
| Deployment | Render (backend + frontend static site) |
