import asyncio
import os

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from backend.service import reconcile_batch_service, reconcile_single_service

FRONTEND_ORIGINS = []
for raw in (os.getenv("FRONTEND_ORIGIN") or "http://localhost:4173").split(","):
    value = raw.strip()
    if value:
        FRONTEND_ORIGINS.append(value)

if not FRONTEND_ORIGINS:
    FRONTEND_ORIGINS = ["http://localhost:4173"]

app = FastAPI(
    title="Settlement Reconciliation API",
    version="0.1.0",
    description="Backend layer for the settlement reconciliation workflow.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
)


class QueryRequest(BaseModel):
    query: str
    record_id: str | None = None
    limit: int | None = Field(default=None, gt=0)


class BatchRequest(BaseModel):
    limit: int | None = Field(default=None, gt=0)


def ensure_positive_limit(limit: int | None, field_name: str = "limit") -> None:
    if limit is not None and limit <= 0:
        raise HTTPException(status_code=400, detail=f"{field_name} must be greater than 0")


batch_lock = asyncio.Lock()


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "backend"}


@app.get("/status")
def status() -> dict:
    hf_token = os.getenv("HF_TOKEN")
    return {
        "backend": "ready",
        "provider": "huggingface",
        "model": os.getenv("HF_MODEL_ID", "zai-org/GLM-5.3-Flash:novita"),
        "configured": bool(hf_token),
        "provider_ready": bool(hf_token),
    }


@app.get("/record/{record_id}")
async def record_get(record_id: str, limit: int | None = None) -> dict:
    ensure_positive_limit(limit)
    result = await reconcile_single_service(record_id=record_id, limit=limit)
    if result.get("status") == "not_found":
        raise HTTPException(status_code=404, detail=result["message"])
    return result


@app.post("/run-batch")
async def run_batch(payload: BatchRequest) -> dict:
    ensure_positive_limit(payload.limit)
    if batch_lock is None:
        return await reconcile_batch_service(payload.limit)

    if batch_lock.locked():
        raise HTTPException(status_code=409, detail="A batch run is already in progress. Please wait for it to finish before starting another one.")

    async with batch_lock:
        return await reconcile_batch_service(payload.limit)


@app.post("/query")
async def query(payload: QueryRequest) -> dict:
    if not payload.query:
        raise HTTPException(status_code=400, detail="query is required")
    ensure_positive_limit(payload.limit)
    if payload.record_id:
        result = await reconcile_single_service(record_id=payload.record_id, limit=payload.limit)
        if result.get("status") == "not_found":
            raise HTTPException(status_code=404, detail=result["message"])
        return result
    return await reconcile_batch_service(payload.limit)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
