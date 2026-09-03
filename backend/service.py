"""What the API layer calls. No FastAPI types here, so each function is testable alone.

The batch is reconciled deterministically by engine/reconciler.py: a 55-record batch
returns in milliseconds and cannot fail on a rate limit, which is what the workspace
opens on. The LLM agent is the reasoning layer and runs one record at a time, only when
asked for, so a demo never waits on 55 sequential model calls.
"""

from datetime import datetime
from typing import Any

from config import API_KEY
from data.generator import BATCH_DATE
from data.schemas import DiscrepancyCause, RecordStatus
from engine import reconciler
from evaluation.eval import evaluate, load_batch, load_truth
from reporting import csv_export
from reporting.report_builder import build_report

AS_OF: datetime = BATCH_DATE


def provider_ready() -> bool:
    """Whether a live model call is possible. The deterministic path never needs this.

    Reads the key config actually resolved, so this cannot drift out of step with the
    provider by checking an environment variable config has stopped using.
    """
    return bool(API_KEY)


def batch_preview(limit: int | None = None) -> dict[str, Any]:
    """Metadata for the synthetic batch, cheap enough to serve on any error path."""
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


def reconcile_batch_deterministic(limit: int | None = None) -> dict[str, Any]:
    """The whole batch, scored against ground truth. No model call."""
    expected, settlements = load_batch(limit)
    records = reconciler.reconcile_batch(expected, settlements, AS_OF)
    return {
        "mode": "deterministic",
        "status": "ok",
        "metrics": evaluate(records, load_truth(limit)),
        "report": build_report(records),
    }


def batch_csv(limit: int | None = None) -> str:
    """The same batch as CSV text. Built server-side so the columns cannot drift."""
    expected, settlements = load_batch(limit)
    return csv_export.to_csv(reconciler.reconcile_batch(expected, settlements, AS_OF))


def _find(record_id: str, limit: int | None):
    expected, settlements = load_batch(limit)
    return next((r for r in expected if r.record_id == record_id), None), settlements


def reconcile_single_deterministic(record_id: str, limit: int | None = None) -> dict[str, Any]:
    """One record through the deterministic path."""
    target, settlements = _find(record_id, limit)
    if target is None:
        return {"status": "not_found", "message": f"Record '{record_id}' is not in the current batch."}

    result = reconciler.reconcile_record(target, settlements, AS_OF)
    return {"mode": "deterministic", "status": "ok", "record": result.model_dump(mode="json")}


async def reconcile_single_live(record_id: str, limit: int | None = None) -> dict[str, Any]:
    """One record through the LLM agent, which chooses its own tools and order."""
    target, settlements = _find(record_id, limit)
    if target is None:
        return {"status": "not_found", "message": f"Record '{record_id}' is not in the current batch."}

    if not provider_ready():
        return {
            "mode": "live",
            "status": "provider_unconfigured",
            "message": "No model API key is configured, so the agent cannot run. The "
                       "deterministic result for this record is available without one.",
        }

    # Imported here so the deterministic path never pulls in a model client.
    from agent.reasoning_agent import reconcile_record

    try:
        result = await reconcile_record(target, settlements, AS_OF)
    except Exception as exc:
        return {"mode": "live", "status": "provider_failed", "message": str(exc)}

    unread = result.primary_cause is DiscrepancyCause.UNRESOLVED and not result.trace
    return {
        "mode": "live",
        "status": "provider_failed" if unread else "ok",
        "record": result.model_dump(mode="json"),
    }


def answer_query(query: str, report: dict[str, Any]) -> str:
    """Answer a question about the batch from the reconciled figures alone.

    Keyword routing over the summary, not a model call: every number quoted here is one
    the deterministic engine computed.
    """
    records = report["records"]
    summary = report["summary"]
    asked = query.lower()

    def listed(rows):
        names = ", ".join(row["record_id"] for row in rows[:5])
        return f"{names} (and {len(rows) - 5} more)" if len(rows) > 5 else names or "none"

    if any(word in asked for word in ("attention", "risk", "urgent", "chase", "wrong")):
        flagged = [
            r for r in records
            if r["primary_cause"] in (DiscrepancyCause.DISPUTE_HOLD.value, DiscrepancyCause.UNRESOLVED.value)
        ]
        if not flagged:
            return "Nothing in this batch needs chasing: every record either reconciles or is explained."
        return (
            f"{len(flagged)} of {summary['total_records']} records need attention — "
            f"{listed(flagged)}. These are held disputes and residuals that match no known cause."
        )

    if any(word in asked for word in ("unresolved", "unexplained", "cannot explain")):
        rows = [r for r in records if r["status"] == RecordStatus.UNRESOLVED.value]
        return (
            f"{len(rows)} records are unresolved: {listed(rows)}. Each has a residual that "
            f"matches no fee, tax or statutory rate, so it is flagged rather than guessed at."
        )

    if any(word in asked for word in ("transit", "waiting", "late", "pending", "not arrived")):
        rows = [r for r in records if r["status"] == RecordStatus.IN_TRANSIT.value]
        return (
            f"{len(rows)} records have no settlement yet and are still inside the T+2 window: "
            f"{listed(rows)}. No action needed on these."
        )

    if any(word in asked for word in ("fee", "mdr", "gst", "tds", "tax", "refund", "fx", "rounding")):
        causes = ", ".join(f"{cause} ({count})" for cause, count in summary["exception_categories"].items())
        return f"Causes found in this batch, excluding records that reconcile cleanly: {causes or 'none'}."

    return (
        f"{summary['total_records']} records reconciled: {summary['matched_records']} match outright, "
        f"{summary['explained_records']} are explained by a known deduction, "
        f"{summary['in_transit_records']} are still in transit and "
        f"{summary['unresolved_records']} are unresolved. {summary['needs_attention']} need attention."
    )


if __name__ == "__main__":
    import asyncio

    batch = reconcile_batch_deterministic()
    assert batch["status"] == "ok" and batch["mode"] == "deterministic"
    assert batch["metrics"]["pairing_accuracy"] == 1.0, batch["metrics"]
    assert batch["metrics"]["diagnosis_accuracy"] == 1.0, batch["metrics"]
    assert len(batch["report"]["records"]) == 55

    limited = reconcile_batch_deterministic(limit=5)
    assert len(limited["report"]["records"]) == 5

    text = batch_csv(limit=3)
    assert text.count("\r\n") == 4, "header plus three rows"

    one = reconcile_single_deterministic("ORD-1000")
    assert one["status"] == "ok" and one["record"]["record_id"] == "ORD-1000"
    assert one["record"]["trace"], "a record with no trace has nothing to show"
    assert reconcile_single_deterministic("NOPE-1")["status"] == "not_found"

    # A missing record must be reported before the provider is ever consulted, so the
    # answer does not depend on whether a key is present.
    missing = asyncio.run(reconcile_single_live("NOPE-1"))
    assert missing["status"] == "not_found", missing

    report = batch["report"]
    assert "need attention" in answer_query("what needs attention?", report)
    assert "unresolved" in answer_query("which are unresolved?", report)
    assert "T+2" in answer_query("anything still waiting?", report)
    assert "reconciled" in answer_query("give me a summary", report)
    for question in ("what needs attention?", "which are unresolved?", "summary", "fees?"):
        assert answer_query(question, report).strip(), question

    print(
        f"[service] ok - deterministic batch {batch['metrics']['pairing_accuracy']:.0%} paired, "
        f"{batch['metrics']['diagnosis_accuracy']:.0%} diagnosed, csv + query answered"
    )
