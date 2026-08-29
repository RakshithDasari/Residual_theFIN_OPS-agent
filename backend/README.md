# Backend

This folder holds the API layer for the reconciliation service.

It is intentionally separated from the model provider so the project can keep running without waiting on a final LLM decision.

## Run

```bash
python -m backend.main
```

Then open http://localhost:8000/docs
