import os
from typing import Any

from agent.reasoning_agent import reconcile_batch, reconcile_record
from config import model
from data.generator import BATCH_DATE
from evaluation.eval import evaluate, load_batch, load_truth
from reporting.report_builder import build_report


def provider_ready() -> bool:
    """Check whether the active Hugging Face provider is configured."""
    return bool(os.getenv("HF_TOKEN")) and model is not None


def batch_preview(limit: int | None = None) -> dict[str, Any]:
    """Return metadata for the synthetic batch without invoking the model."""
    expected, settlements = load_batch(limit)
    return {
        "records_total": len(expected),
        "settlements_total": len(settlements),
        "business_types": sorted({record.business_type.value for record in expected}),
        "sample": [
            {
                "record_id": record.record_id,
                "business_type": record.business_type.value,
                "expected_amount_paise": record.expected_amount_paise,
                "reference_hint": record.reference_hint,
            }
            for record in expected[:5]
        ],
    }


async def reconcile_single_service(record_id: str | None = None, limit: int | None = None) -> dict[str, Any]:
    """Reconcile a single record from the synthetic batch if a live model is configured."""
    expected, settlements = load_batch(limit)
    target = next((record for record in expected if record.record_id == record_id), None)
    if target is None:
        return {
            "mode": "live",
            "status": "not_found",
            "message": f"Record '{record_id}' was not found in the current batch.",
            "preview": batch_preview(limit),
        }

    if not provider_ready():
        return {
            "mode": "degraded",
            "status": "provider_unconfigured",
            "message": "Model provider is not configured, so no live reconciliation is possible yet.",
            "preview": batch_preview(limit),
        }

    result = await reconcile_record(target, settlements, BATCH_DATE)
    return {"mode": "live", "status": "ok", "record": result.model_dump(mode="json")}


async def reconcile_batch_service(limit: int | None = None) -> dict[str, Any]:
    """Run the batch reconciliation if the active provider is configured."""
    if limit is not None and limit <= 0:
        raise ValueError("limit must be greater than 0")

    if not provider_ready():
        return {
            "mode": "degraded",
            "status": "provider_unconfigured",
            "message": "Backend is ready; the Hugging Face token is not configured.",
            "preview": batch_preview(limit),
        }

    try:
        expected, settlements = load_batch(limit)
        records = await reconcile_batch(expected, settlements, BATCH_DATE)
        truth = load_truth(limit)
        metrics = evaluate(records, truth)
        return {
            "mode": "live",
            "status": "ok",
            "provider_failures": 0,
            "metrics": metrics,
            "report": build_report(records),
        }
    except Exception as exc:  # pragma: no cover - provider/runtime failure surfaces honestly
        return {
            "mode": "live",
            "status": "provider_failed",
            "provider_failures": 1,
            "message": str(exc),
            "preview": batch_preview(limit),
        }
