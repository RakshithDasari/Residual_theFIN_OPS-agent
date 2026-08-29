from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.service import reconcile_batch_service, reconcile_single_service

app = FastAPI(
    title="Settlement Reconciliation API",
    version="0.1.0",
    description="Backend layer for the settlement reconciliation workflow.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class QueryRequest(BaseModel):
    query: str
    record_id: str | None = None
    limit: int | None = None


class BatchRequest(BaseModel):
    limit: int | None = None


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "backend"}


@app.get("/status")
def status() -> dict:
    return {
        "backend": "ready",
        "model": "provider-plugged",
        "note": "Live provider selection remains separate from backend logic.",
    }


@app.get("/record/{record_id}")
async def record_get(record_id: str, limit: int | None = None) -> dict:
    return await reconcile_single_service(record_id=record_id, limit=limit)


@app.post("/run-batch")
async def run_batch(payload: BatchRequest) -> dict:
    return await reconcile_batch_service(payload.limit)


@app.post("/query")
async def query(payload: QueryRequest) -> dict:
    if not payload.query:
        raise HTTPException(status_code=400, detail="query is required")
    if payload.record_id:
        return await reconcile_single_service(record_id=payload.record_id, limit=payload.limit)
    return await reconcile_batch_service(payload.limit)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("backend.main:app", host="0.0.0.0", port=8000, reload=True)
