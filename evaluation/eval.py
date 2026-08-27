import argparse
import asyncio
import json
from collections import Counter
from pathlib import Path

from agent.reasoning_agent import reconcile_batch
from config import BATCH_FILE, GROUND_TRUTH_FILE
from data.generator import BATCH_DATE
from data.schemas import (
    DiscrepancyCause,
    ExpectedRecord,
    GroundTruthEntry,
    ReconciledRecord,
    SettlementRecord,
    TraceStep,
)
from reporting.report_builder import build_report


def evaluate(records: list[ReconciledRecord], truth: list[GroundTruthEntry]) -> dict:
    """Score pairings, diagnoses, and tool use against the sidecar answer key."""
    truth_by_id = {entry.record_id: entry for entry in truth}
    assert {record.record_id for record in records} == set(truth_by_id), "records and answer key differ"

    pairing_correct = sum(
        record.settlement_id == truth_by_id[record.record_id].settlement_id for record in records
    )
    diagnosis_correct = sum(
        record.primary_cause is truth_by_id[record.record_id].primary_cause for record in records
    )
    per_cause = {}

    for cause in DiscrepancyCause:
        actual = [entry for entry in truth if entry.primary_cause is cause]
        predicted = [record for record in records if record.primary_cause is cause]
        true_positive = sum(
            record.primary_cause is truth_by_id[record.record_id].primary_cause for record in predicted
        )
        per_cause[cause.value] = {
            "support": len(actual),
            "precision": round(true_positive / len(predicted), 3) if predicted else None,
            "recall": round(true_positive / len(actual), 3) if actual else None,
        }

    total = len(records)
    tool_calls = [len(record.trace) for record in records]
    return {
        "records_evaluated": total,
        "pairing_accuracy": round(pairing_correct / total, 3) if total else 0.0,
        "diagnosis_accuracy": round(diagnosis_correct / total, 3) if total else 0.0,
        "per_cause": per_cause,
        "tool_path": {
            "average_calls_per_record": round(sum(tool_calls) / total, 2) if total else 0.0,
            "calls_by_tool": dict(
                Counter(step.step for record in records for step in record.trace)
            ),
            "records_with_no_tool_calls": sum(calls == 0 for calls in tool_calls),
        },
    }


def load_batch(limit: int | None = None) -> tuple[list[ExpectedRecord], list[SettlementRecord]]:
    """Load the synthetic records the agent receives."""
    batch = json.loads(BATCH_FILE.read_text())
    expected = [ExpectedRecord(**record) for record in batch["expected_records"]]
    settlements = [SettlementRecord(**record) for record in batch["settlements"]]
    return expected[:limit], settlements


def load_truth(limit: int | None = None) -> list[GroundTruthEntry]:
    """Load the answer key after reconciliation is complete."""
    truth = [GroundTruthEntry(**entry) for entry in json.loads(GROUND_TRUTH_FILE.read_text())]
    return truth[:limit]


async def run(limit: int | None, output: Path) -> dict:
    """Run the agent, then evaluate its completed results."""
    expected, settlements = load_batch(limit)
    records = await reconcile_batch(expected, settlements, BATCH_DATE)
    result = {"metrics": evaluate(records, load_truth(limit)), "report": build_report(records)}
    output.write_text(json.dumps(result, indent=2))
    return result


def self_check() -> None:
    """Verify the scoring math without an LLM call."""
    truth = [
        GroundTruthEntry(record_id="ORD-1", primary_cause=DiscrepancyCause.MDR_FEE, settlement_id="setl_1"),
        GroundTruthEntry(record_id="ORD-2", primary_cause=DiscrepancyCause.TDS, settlement_id="setl_2"),
        GroundTruthEntry(record_id="ORD-3", primary_cause=DiscrepancyCause.IN_TRANSIT),
    ]
    records = [
        ReconciledRecord(
            record_id="ORD-1",
            business_type="ecommerce",
            expected_amount_paise=100_000,
            settlement_id="setl_1",
            primary_cause=DiscrepancyCause.MDR_FEE,
            explanation="Matched.",
            confidence=0.95,
            trace=[TraceStep(step="try_exact_match", result="found", detail="Matched")],
        ),
        ReconciledRecord(
            record_id="ORD-2",
            business_type="saas",
            expected_amount_paise=100_000,
            settlement_id="setl_2",
            primary_cause=DiscrepancyCause.FX_MARKUP,
            explanation="Wrong on purpose.",
            confidence=0.8,
            trace=[TraceStep(step="check_arithmetic_causes", result="ok", detail="Checked")],
        ),
        ReconciledRecord(
            record_id="ORD-3",
            business_type="bookings",
            expected_amount_paise=100_000,
            primary_cause=DiscrepancyCause.IN_TRANSIT,
            explanation="Pending.",
            confidence=0.9,
            trace=[TraceStep(step="days_awaiting_settlement", result="ok", detail="One day")],
        ),
    ]
    metrics = evaluate(records, truth)
    assert metrics["pairing_accuracy"] == 1.0
    assert metrics["diagnosis_accuracy"] == 0.667
    assert metrics["per_cause"]["tds"]["recall"] == 0.0
    assert metrics["per_cause"]["fx_markup"]["precision"] == 0.0
    assert metrics["tool_path"]["average_calls_per_record"] == 1.0


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, help="Start with five records before a full batch")
    parser.add_argument("--output", type=Path, default=Path("evaluation/latest_results.json"))
    parser.add_argument("--self-check", action="store_true")
    args = parser.parse_args()

    if args.self_check:
        self_check()
        print("[eval] ok - pairing, diagnosis, and tool-path metrics verified")
        raise SystemExit

    result = asyncio.run(run(args.limit, args.output))
    metrics = result["metrics"]
    print(
        f"[eval] {metrics['records_evaluated']} records - "
        f"pairing {metrics['pairing_accuracy']:.1%}, diagnosis {metrics['diagnosis_accuracy']:.1%}"
    )
