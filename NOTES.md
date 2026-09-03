# Residual — deployment notes

## Backend — Render

**Service type:** Web Service  
**Runtime:** Python  
**Build command:** `pip install -r requirements.txt`  
**Start command:** `uvicorn backend.main:app --host 0.0.0.0 --port $PORT`  
**Root directory:** ` ` (repo root)

### Environment variables to set in Render dashboard

| Variable | Value | Notes |
|---|---|---|
| `HF_TOKEN` | `hf_...` | Your HuggingFace token. Never commit. |
| `HF_BASE_URL` | `https://router.huggingface.co/v1` | Already in render.yaml as a plain value |
| `HF_MODEL_ID` | `zai-org/GLM-5.3-Flash:novita` | Already in render.yaml |
| `FRONTEND_ORIGIN` | `https://your-app.vercel.app` | Set AFTER you get the Vercel URL. Comma-separate multiple origins if needed. |

`HF_TOKEN` and `FRONTEND_ORIGIN` are marked `sync: false` in render.yaml — Render will prompt you to fill them in the dashboard; they are never written to the file.

### CORS
`backend/main.py` reads `FRONTEND_ORIGIN` from the environment and splits on commas. Set it to include both your Vercel URL and localhost for local testing:
```
FRONTEND_ORIGIN=https://residual.vercel.app,http://localhost:5173,http://localhost:4173
```

---

## Frontend — Vercel

**Root directory:** `frontend`  
**Build command:** `npm run build`  
**Output directory:** `dist`  
**Framework preset:** Vite

### Environment variable to set in Vercel dashboard

| Variable | Value |
|---|---|
| `VITE_API_URL` | `https://your-render-service.onrender.com` |

Set this BEFORE the first deploy (or redeploy after setting it — Vite bakes it in at build time).

`vercel.json` in `frontend/` adds an SPA rewrite so all routes (`/app`, `/app/chat`, etc.) resolve to `index.html`.

---

## End-to-end verification checklist

1. `GET https://<render-url>/health` → `{"status":"ok","service":"backend"}`
2. `GET https://<render-url>/batch` → JSON with `status: "ok"` and 55 records
3. Load `https://<vercel-url>/` → landing page renders
4. Navigate to `/app` → reconciliation stream loads batch data
5. Navigate to `/app/records` → table populates, CSV download works
6. Navigate to `/app/ledger` → both panels load, hover highlighting works
7. Navigate to `/app/chat` → send a question, get a real response from the agent

---

## .gitignore — what's excluded

- `.env` and `.env.*` — all local secrets
- `PROJECT_STORY.md`, `NOTES.md`, `CLAUDE.md` — narrative files
- `.venv/`, `frontend/node_modules/`, `frontend/dist/`
