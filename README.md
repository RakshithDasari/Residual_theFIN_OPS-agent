# Settlement Reconciliation Agent

This project reconciles a merchant's expected order records against Razorpay-style settlement records and explains the discrepancy in plain language, with a confidence score and a reasoning trace.

The project is intentionally read-only and batch-shaped. It does not write back to any system, and it does not maintain auth or user state.

## Current architecture

- Backend: FastAPI service in [backend/main.py](backend/main.py)
- Agent orchestration: Agno in [agent/reasoning_agent.py](agent/reasoning_agent.py)
- Deterministic reconciliation logic: [engine/matcher.py](engine/matcher.py)
- Data model and taxonomy: [data/schemas.py](data/schemas.py), [agent/taxonomy.py](agent/taxonomy.py)
- Frontend: React + Vite in [frontend](frontend)

The live model currently uses the OpenRouter-compatible provider with the Moonshot Kimi model configured in [config.py](config.py). The default model is `moonshotai/kimi-k3` via the OpenRouter base URL.

## What is synthetic

The expected records and settlement batch are synthetic for local validation. The project is designed to reconcile a merchant's own expected-side data against settlement data, but the batch used in this repo is a reproducible synthetic dataset for offline testing and demo work.

## Environment setup

1. Create a Python environment.
2. Install backend dependencies:

```bash
pip install -r requirements.txt
```

3. Install frontend dependencies:

```bash
cd frontend
npm install
```

4. Create a local `.env` from the template:

```bash
cp .env.example .env
```

5. Fill in the keys you are actually using. At minimum, set the provider key that matches your current configuration:

```env
OPENROUTER_API_KEY=your_key_here
FRONTEND_ORIGIN=http://localhost:4173
```

You may also keep other provider keys in the file if you are switching providers locally, but the backend will only use whichever key is selected by the current config.

## Run locally

Backend:

```bash
python -m backend.main
```

Frontend:

```bash
cd frontend
npm run dev -- --host 0.0.0.0 --port 4173
```

Then open:
- Backend: http://localhost:8000/docs
- Frontend: http://localhost:4173/

## Self-checks

Run these from the project root:

```bash
python -m data.schemas
python -m data.generator
python -m engine.matcher
python -m agent.taxonomy
python -m context
python -m agent.tools
python -m agent.reasoning_agent
```

These run offline and do not require a live provider call.

## Notes

- The project is intentionally not a production payment workflow; it is a reconciliation demo and audit tool.
- Accuracy is computed by the evaluation script in [evaluation/eval.py](evaluation/eval.py), not by cherry-picked numbers.
- Live provider access can fail because of billing, quota, or provider-side policy. The backend and UI are designed to surface those failures honestly rather than masking them with fake success data.
