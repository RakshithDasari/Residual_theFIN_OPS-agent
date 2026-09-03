"""What the API layer calls. No FastAPI types here, so each function is testable alone.

The batch is reconciled deterministically by engine/reconciler.py: a 55-record batch
returns in milliseconds and cannot fail on a rate limit, which is what the workspace
opens on. The LLM agent is the reasoning layer and runs one record at a time, only when
asked for, so a demo never waits on 55 sequential model calls.
"""

from datetime import datetime
from typing import Any

from config import API_KEY, model
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


def answer_query(query: str, report: dict[str, Any], history: list[dict] | None = None) -> dict:
    """Answer a question about the batch. Returns {text, cards?, table?, records?}.

    Falls back to keyword routing if the model is not configured or errors out.
    History is [{role, content}] — used to give the model session memory.
    """
    if provider_ready():
        try:
            return _answer_with_llm(query, report, history or [])
        except Exception:
            pass  # fall through to keyword fallback

    return _answer_keyword(query, report)


def _answer_with_llm(query: str, report: dict[str, Any], history: list[dict]) -> dict:
    """LLM answer with optional structured payload for the frontend to render."""
    from agno.models.message import Message

    records = report["records"]
    summary = report["summary"]

    # Build compact record table — each line has everything needed for specific answers
    record_lines = []
    for r in records:
        diff = ""
        if r.get("actual_amount_paise") is not None:
            d = r["actual_amount_paise"] - r["expected_amount_paise"]
            diff = f" diff=₹{d/100:+.2f}"
        record_lines.append(
            f"{r['record_id']} | {r['business_type']} | "
            f"expected=₹{r['expected_amount_paise']/100:.2f} "
            f"settled={'₹'+str(round(r['actual_amount_paise']/100,2)) if r.get('actual_amount_paise') is not None else 'nil'}"
            f"{diff} | {r['status']} | cause={r['primary_cause']} | expl={r.get('explanation','')[:120]}"
        )
    batch_ctx = "\n".join(record_lines)

    needs_attention = [r for r in records if r["status"] == "unresolved" or r["primary_cause"] == "dispute_hold"]
    unresolved_ctx = "\n".join(
        f"  {r['record_id']}: expected=₹{r['expected_amount_paise']/100:.2f}, "
        f"settled={'₹'+str(round(r['actual_amount_paise']/100,2)) if r.get('actual_amount_paise') is not None else 'nil'}, "
        f"cause={r['primary_cause']}, note={r.get('explanation','')[:100]}"
        for r in needs_attention
    )

    system_prompt = f"""You are Reya — a sharp personal accountant who has just finished running a Razorpay settlement reconciliation for this merchant. You know every number, every gap, every cause. You talk like a trusted advisor: direct, specific, warm. Never robotic.

RULES:
1. Always answer the SPECIFIC question. Do not give a generic batch summary unless they asked for one.
2. Quote real record IDs, real rupee amounts, real causes. Never say "some records" when you have names.
3. If the answer involves a list of records, include a JSON payload after your prose using this EXACT format:
   |||JSON|||
   {{"type": "records", "rows": [{{"id": "ORD-1000", "status": "unresolved", "expected": 3541.00, "settled": 2832.40, "diff": -708.60, "cause": "mdr_fee", "explanation": "short explanation"}}]}}
   |||END|||
4. For single-record deep dives, include:
   |||JSON|||
   {{"type": "record_detail", "record_id": "ORD-1000", "status": "explained", "expected": 3541.00, "settled": 2832.40, "diff": -708.60, "cause": "mdr_fee", "confidence": 0.95, "explanation": "full explanation"}}
   |||END|||
5. For batch summaries, include:
   |||JSON|||
   {{"type": "summary", "matched": {summary['matched_records']}, "explained": {summary['explained_records']}, "in_transit": {summary['in_transit_records']}, "unresolved": {summary['unresolved_records']}, "needs_attention": {summary['needs_attention']}}}
   |||END|||
6. If someone says hi / asks your name / makes small talk — respond naturally, no JSON.
7. NEVER include JSON unless the answer genuinely benefits from it.

BATCH CONTEXT — {summary['total_records']} records, settlement date 24 Aug 2026:
Matched: {summary['matched_records']} | Explained: {summary['explained_records']} | In transit: {summary['in_transit_records']} | Unresolved: {summary['unresolved_records']} | Needs attention: {summary['needs_attention']}

Records needing attention ({len(needs_attention)}):
{unresolved_ctx or "  None"}

Full record detail:
{batch_ctx}"""

    messages = [Message(role="system", content=system_prompt)]
    for turn in history:
        role = turn.get("role", "user")
        content = turn.get("content", "")
        if role in ("user", "assistant") and content:
            messages.append(Message(role=role, content=content))
    messages.append(Message(role="user", content=query))

    response = model.response(messages)
    raw = (response.content or "").strip()

    # Parse out the optional JSON payload
    import re
    json_match = re.search(r"\|\|\|JSON\|\|\|\s*(.*?)\s*\|\|\|END\|\|\|", raw, re.DOTALL)
    text = re.sub(r"\|\|\|JSON\|\|\|.*?\|\|\|END\|\|\|", "", raw, flags=re.DOTALL).strip()

    payload: dict[str, Any] = {"text": text}
    if json_match:
        import json as _json
        try:
            payload["ui"] = _json.loads(json_match.group(1))
        except Exception:
            pass

    return payload


def _answer_keyword(query: str, report: dict[str, Any]) -> dict:
    """Keyword-routing fallback — returns same {text, ui?} shape."""
    records = report["records"]
    summary = report["summary"]
    asked = query.lower()

    def listed(rows):
        names = ", ".join(row["record_id"] for row in rows[:5])
        return f"{names} (and {len(rows) - 5} more)" if len(rows) > 5 else names or "none"

    if any(word in asked for word in ("attention", "risk", "urgent", "chase", "wrong", "review", "human")):
        flagged = [r for r in records if r["primary_cause"] in (DiscrepancyCause.DISPUTE_HOLD.value, DiscrepancyCause.UNRESOLVED.value)]
        if not flagged:
            return {"text": "Nothing needs chasing right now — every record either reconciles cleanly or is explained by a known deduction."}
        text = (f"{len(flagged)} of {summary['total_records']} records need a human: "
                f"{listed(flagged)}. These have residuals that match no known fee or tax rate.")
        ui = {"type": "records", "rows": [
            {"id": r["record_id"], "status": r["status"],
             "expected": r["expected_amount_paise"] / 100,
             "settled": r["actual_amount_paise"] / 100 if r.get("actual_amount_paise") else None,
             "diff": (r["actual_amount_paise"] - r["expected_amount_paise"]) / 100 if r.get("actual_amount_paise") else None,
             "cause": r["primary_cause"], "explanation": r.get("explanation", "")}
            for r in flagged
        ]}
        return {"text": text, "ui": ui}

    if any(word in asked for word in ("unresolved", "unexplained")):
        rows = [r for r in records if r["status"] == RecordStatus.UNRESOLVED.value]
        text = f"{len(rows)} unresolved: {listed(rows)}. Each has a residual matching no fee, tax or statutory rate."
        return {"text": text, "ui": {"type": "records", "rows": [
            {"id": r["record_id"], "status": r["status"],
             "expected": r["expected_amount_paise"] / 100,
             "settled": r["actual_amount_paise"] / 100 if r.get("actual_amount_paise") else None,
             "diff": (r["actual_amount_paise"] - r["expected_amount_paise"]) / 100 if r.get("actual_amount_paise") else None,
             "cause": r["primary_cause"], "explanation": r.get("explanation", "")}
            for r in rows
        ]}}

    if any(word in asked for word in ("transit", "waiting", "pending")):
        rows = [r for r in records if r["status"] == RecordStatus.IN_TRANSIT.value]
        return {"text": f"{len(rows)} records still inside the T+2 window: {listed(rows)}. No action needed."}

    if any(word in asked for word in ("summary", "overview", "batch", "total", "how many")):
        return {"text": (
            f"Batch of {summary['total_records']} records: "
            f"{summary['matched_records']} matched, {summary['explained_records']} explained, "
            f"{summary['in_transit_records']} in transit, {summary['unresolved_records']} unresolved. "
            f"{summary['needs_attention']} need attention."
        ), "ui": {"type": "summary", "matched": summary['matched_records'],
                  "explained": summary['explained_records'],
                  "in_transit": summary['in_transit_records'],
                  "unresolved": summary['unresolved_records'],
                  "needs_attention": summary['needs_attention']}}

    return {"text": (
        f"{summary['total_records']} records reconciled: {summary['matched_records']} match outright, "
        f"{summary['explained_records']} explained by deduction, "
        f"{summary['in_transit_records']} in transit, {summary['unresolved_records']} unresolved."
    )}


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
