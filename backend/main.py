import os

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

from backend.service import (
    answer_query,
    batch_csv,
    batch_preview,
    provider_ready,
    reconcile_batch_deterministic,
    reconcile_single_deterministic,
    reconcile_single_live,
)
from config import MODEL_ID

FRONTEND_ORIGINS = [
    origin.strip()
    for origin in (os.getenv("FRONTEND_ORIGIN") or "http://localhost:4173").split(",")
    if origin.strip()
]

app = FastAPI(
    title="Settlement Reconciliation API",
    version="1.0.0",
    description="Reconciles merchant records against Razorpay settlements and explains the gaps.",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    # Without this the browser cannot read the filename off a download response.
    expose_headers=["Content-Disposition"],
)


class QueryRequest(BaseModel):
    query: str = Field(..., min_length=1)
    limit: int | None = Field(default=None, gt=0)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "service": "backend"}


@app.get("/status")
def status() -> dict:
    """What is actually configured. The deterministic path works with no key at all."""
    return {
        "backend": "ready",
        "model": MODEL_ID,
        "live_agent_available": provider_ready(),
        "deterministic_available": True,
    }


@app.get("/preview")
def preview(limit: int | None = Query(default=None, gt=0)) -> dict:
    return {"status": "ok", "preview": batch_preview(limit)}


@app.get("/batch")
def batch(limit: int | None = Query(default=None, gt=0)) -> dict:
    return reconcile_batch_deterministic(limit)


@app.get("/batch.csv")
def batch_download(limit: int | None = Query(default=None, gt=0)) -> Response:
    return Response(
        content=batch_csv(limit),
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="residual-reconciliation.csv"'},
    )


@app.get("/record/{record_id}")
async def record_get(
    record_id: str,
    limit: int | None = Query(default=None, gt=0),
    live: bool = Query(default=False, description="Run the LLM agent instead of the deterministic engine"),
) -> dict:
    result = (
        await reconcile_single_live(record_id, limit) if live
        else reconcile_single_deterministic(record_id, limit)
    )
    if result["status"] == "not_found":
        raise HTTPException(status_code=404, detail=result["message"])
    return result


@app.post("/query")
def query(payload: QueryRequest) -> dict:
    batch_result = reconcile_batch_deterministic(payload.limit)
    return {
        "status": "ok",
        "answer": answer_query(payload.query, batch_result["report"]),
        "summary": batch_result["report"]["summary"],
    }


if __name__ == "__main__":
    from fastapi.testclient import TestClient

    client = TestClient(app)

    assert client.get("/health").json()["status"] == "ok"

    status_body = client.get("/status").json()
    assert status_body["model"] == MODEL_ID, "status must report the model config actually uses"
    assert status_body["deterministic_available"] is True

    body = client.get("/batch?limit=55").json()
    assert body["status"] == "ok" and len(body["report"]["records"]) == 55
    assert body["metrics"]["pairing_accuracy"] == 1.0

    csv_response = client.get("/batch.csv?limit=5")
    assert csv_response.status_code == 200
    assert csv_response.headers["content-type"].startswith("text/csv")
    assert "attachment" in csv_response.headers["content-disposition"]
    assert csv_response.text.count("\r\n") == 6

    one = client.get("/record/ORD-1000")
    assert one.status_code == 200 and one.json()["record"]["record_id"] == "ORD-1000"
    assert client.get("/record/NOPE-1").status_code == 404

    # gt=0 is enforced by the schema, so a bad limit is rejected before any handler runs.
    assert client.get("/batch?limit=0").status_code == 422
    assert client.post("/query", json={"query": ""}).status_code == 422

    answered = client.post("/query", json={"query": "what needs attention?"}).json()
    assert answered["status"] == "ok" and answered["answer"].strip()
    assert answered["summary"]["total_records"] == 55

    # A foreign origin must not be told it is allowed.
    cors = client.get("/health", headers={"Origin": "http://evil.example"})
    assert "access-control-allow-origin" not in {k.lower() for k in cors.headers}

    print(f"[backend] ok - deterministic batch, csv download, query, 404 and 422 all correct")
