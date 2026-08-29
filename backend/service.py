import os
from typing import Any

from agent.reasoning_agent import reconcile_batch, reconcile_record
from config import model
from data.generator import BATCH_DATE
from evaluation.eval import evaluate, load_batch, load_truth
from reporting.report_builder import build_report


def provider_ready() -> bool:
    """Check if a live model provider is configured at all."""
    return bool(
        os.getenv("OPENROUTER_API_KEY")
        or os.getenv("KIOSAPI_API_KEY")
        or os.getenv("OPENAI_API_KEY")
        or os.getenv("GEMINI_API_KEY")
        or os.getenv("NVIDIA_API_KEY")
    ) and model is not None


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
    if not provider_ready():
        return {
            "mode": "degraded",
            "status": "provider_unconfigured",
            "message": "Model provider is not configured, so no live reconciliation is possible yet.",
            "preview": batch_preview(limit),
        }

    expected, settlements = load_batch(limit)
    target = next((record for record in expected if record.record_id == record_id), expected[0])
    result = await reconcile_record(target, settlements, BATCH_DATE)
    return {"mode": "live", "status": "ok", "record": result.model_dump(mode="json")}


async def reconcile_batch_service(limit: int | None = None) -> dict[str, Any]:
    """Run the batch reconciliation if a live provider is configured, otherwise return degraded status."""
    if not provider_ready():
        return {
            "mode": "degraded",
            "status": "provider_unconfigured",
            "message": "Backend is ready; model provider configuration is pending.",
            "preview": batch_preview(limit),
        }

    expected, settlements = load_batch(limit)
    records = await reconcile_batch(expected, settlements, BATCH_DATE)
    truth = load_truth(limit)
    return {
        "mode": "live",
        "status": "ok",
        "metrics": evaluate(records, truth),
        "report": build_report(records),
    }
