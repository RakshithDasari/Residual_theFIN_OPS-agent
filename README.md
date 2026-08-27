# Settlement Reconciliation Agent

Razorpay AI Buildathon 2026 — Track 04, AI Finance Controller.

Reconciles a merchant's own expected order records against actual Razorpay
settlements, and explains every discrepancy it finds in plain language with a
confidence score.

Existing recon tooling tells a merchant *that* something didn't reconcile.
This tells them *why*.

## Scope

An MVP that closes one finance-ops loop properly, with measured accuracy — not a
platform. It deliberately has no auth, no database, no write-back to any system, and
no retrieval layer. Reconciliation is read-only and batch-shaped, and building it that
way was a design decision rather than a shortcut.

The *actual* side is the real Razorpay Settlements API in test mode. The *expected*
side is synthetic, and is described that way everywhere — even in production it would
come from the merchant's own order system, not from Razorpay.

Accuracy figures are whatever the eval script computes, reported per cause, including
the causes the agent handles badly. See [NOTES.md](NOTES.md) for every locked decision
and its reasoning.

The agent uses DeepSeek V4 Flash through NVIDIA's OpenAI-compatible API.

## Live API boundary

The Razorpay test credentials successfully authenticated against both `GET /v1/settlements/`
and `GET /v1/settlements/recon/combined`; each returned zero records. Test-mode settlement
history is therefore not used to inflate the batch - the 55-record workload remains synthetic.

## Status

In development. Agent and tool layers are verified offline across all 55 records. NVIDIA's
current budget-pool quota must be restored before the first live agent run.

## Setup

```bash
pip install -r requirements.txt
cp .env.example .env   # fill in your keys
```

Every module self-checks. Run them from the project root:

```bash
python -m data.schemas && python -m data.generator && python -m engine.matcher && python -m agent.taxonomy && python -m context && python -m agent.tools && python -m agent.reasoning_agent
```

All of those run offline — no API key, no LLM calls.

## Watching the agent work

`playground.py` serves the agent through Agno's `AgentOS`, which shows each tool call as
it happens. Useful for seeing that the agent picks its own path rather than following a
script.

```bash
python playground.py
```

It binds one record at startup (`PLAYGROUND_RECORD` in `playground.py`); change the index
to reconcile a different one. Needs `NVIDIA_API_KEY`.
