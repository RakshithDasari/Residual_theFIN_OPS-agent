"""Deterministic reconciliation over a whole batch, with no model in the loop.

The agent in agent/ decides which tool to call and in what order. This does the same
job by running every check in a fixed order and reading the taxonomy signatures as
code. It exists because a demo cannot wait on 55 sequential LLM calls, and because a
deterministic result is the yardstick the agent's accuracy is measured against.

The classification here is the taxonomy in agent/taxonomy.py turned into branches. If
the two ever disagree, the taxonomy is the specification and this is the bug.

Run from the project root:  python -m engine.reconciler
"""

from data.schemas import DiscrepancyCause, ExpectedRecord, ReconciledRecord, SettlementRecord, TraceStep
from engine import matcher

T_PLUS_DAYS = 2

# A refund is a share of the sale a customer got back, so it lands in whole percentage
# points of the order, not a fraction of one. Below this, with every statutory amount
# already ruled out, there is no positive evidence for a refund and unresolved is the
# honest answer — a residual can be material and still be unexplained.
MATERIAL_RESIDUAL_PCT = 10.0

# Statutory amounts are computed with a rounding step, so an exact == would miss by a
# paise on some records. Two paise is the same tolerance the matcher allows for drift.
AMOUNT_TOLERANCE_PAISE = 2


def _close(value: int, target: int) -> bool:
    return abs(value - target) <= AMOUNT_TOLERANCE_PAISE


def _classify(evidence: dict) -> tuple[DiscrepancyCause, list[DiscrepancyCause], float]:
    """Name the cause of the gap from a check_arithmetic_causes payload.

    Returns the primary cause, the deductions that also applied, and a confidence that
    reflects which branch fired: an exact arithmetic identity is worth more than a
    residual that merely looks material.
    """
    residual = evidence["residual_paise"]
    fees = evidence["fees_paise"]
    reference = evidence["reference_amounts"]

    contributing = []
    if fees:
        contributing.append(DiscrepancyCause.MDR_FEE)
    if evidence["tax_paise"]:
        contributing.append(DiscrepancyCause.GST_ON_FEE)

    # The fee and its GST closed the gap on their own.
    if residual == 0:
        return DiscrepancyCause.MDR_FEE, [c for c in contributing if c is not DiscrepancyCause.MDR_FEE], 0.99

    # Expected was already net of the fee, so subtracting it again double-counted.
    if fees and _close(residual, -fees):
        return DiscrepancyCause.GST_ON_FEE, [], 0.97

    if residual > 0:
        if _close(residual, reference["tds_at_1pct_paise"]):
            return DiscrepancyCause.TDS, contributing, 0.95
        if _close(residual, reference["fx_markup_at_3pct_paise"]):
            return DiscrepancyCause.FX_MARKUP, contributing, 0.95

    if evidence["within_rounding_tolerance"]:
        return DiscrepancyCause.ROUNDING_DRIFT, contributing, 0.92

    if residual > 0 and evidence["residual_pct_of_expected"] >= MATERIAL_RESIDUAL_PCT:
        return DiscrepancyCause.PARTIAL_REFUND, contributing, 0.78

    return DiscrepancyCause.UNRESOLVED, contributing, 0.4


def reconcile_record(expected: ExpectedRecord, settlements, as_of) -> ReconciledRecord:
    """Pair one record and explain its gap, recording the same trace the agent would."""
    from reporting import narrative

    trace = []
    settlement = matcher.try_exact_match(expected, settlements)
    if settlement is not None:
        trace.append(TraceStep(
            step="try_exact_match",
            result="found",
            detail=f"UTR {settlement.utr} equals the reference on this record",
        ))
        matched_by_reference = False
    else:
        trace.append(TraceStep(
            step="try_exact_match",
            result="not found",
            detail=f"no settlement UTR equals reference {expected.reference_hint}",
        ))
        settlement, detail = matcher.try_fuzzy_match(expected, settlements)
        trace.append(TraceStep(
            step="try_fuzzy_match",
            result="found" if settlement else "not found",
            detail=detail,
        ))
        matched_by_reference = settlement is not None

    if settlement is None:
        days = matcher.days_awaiting_settlement(expected, as_of)
        trace.append(TraceStep(
            step="days_awaiting_settlement",
            result="ok",
            detail=f"placed {days} days ago, Razorpay settles on a T+{T_PLUS_DAYS} cycle",
        ))
        cause = DiscrepancyCause.IN_TRANSIT if days <= T_PLUS_DAYS else DiscrepancyCause.DISPUTE_HOLD
        return ReconciledRecord(
            record_id=expected.record_id,
            business_type=expected.business_type,
            expected_amount_paise=expected.expected_amount_paise,
            primary_cause=cause,
            explanation=narrative.narrate(cause, None, expected.expected_amount_paise, days=days),
            confidence=0.93,
            trace=trace,
        )

    evidence = matcher.check_arithmetic_causes(expected, settlement)
    trace.append(TraceStep(
        step="check_arithmetic_causes",
        result="ok",
        detail=f"residual {evidence['residual_paise']} paise against fees {evidence['fees_paise']} "
               f"and tax {evidence['tax_paise']}",
    ))

    cause, contributing, confidence = _classify(evidence)

    # A fuzzy pairing is the finding when the money itself reconciles: the merchant's
    # reference was wrong, not their accounting.
    if matched_by_reference and cause is DiscrepancyCause.MDR_FEE:
        cause, confidence = DiscrepancyCause.UTR_MISMATCH, 0.96
        contributing = [DiscrepancyCause.MDR_FEE, DiscrepancyCause.GST_ON_FEE]

    return ReconciledRecord(
        record_id=expected.record_id,
        business_type=expected.business_type,
        expected_amount_paise=expected.expected_amount_paise,
        actual_amount_paise=settlement.amount_paise,
        settlement_id=settlement.settlement_id,
        primary_cause=cause,
        contributing_causes=contributing,
        explanation=narrative.narrate(cause, evidence, expected.expected_amount_paise),
        confidence=confidence,
        trace=trace,
    )


def reconcile_batch(expected_records, settlements, as_of) -> list[ReconciledRecord]:
    """Every record, in the order the merchant's system listed them."""
    return [reconcile_record(expected, settlements, as_of) for expected in expected_records]


if __name__ == "__main__":
    import json
    import time
    from datetime import datetime

    from config import BATCH_FILE, GROUND_TRUTH_FILE
    from data.schemas import GroundTruthEntry

    batch = json.loads(BATCH_FILE.read_text())
    expected_records = [ExpectedRecord(**r) for r in batch["expected_records"]]
    settlements = [SettlementRecord(**s) for s in batch["settlements"]]
    truth = {
        t["record_id"]: GroundTruthEntry(**t)
        for t in json.loads(GROUND_TRUTH_FILE.read_text())
    }
    as_of = datetime(2026, 8, 24)

    started = time.perf_counter()
    results = reconcile_batch(expected_records, settlements, as_of)
    elapsed_ms = (time.perf_counter() - started) * 1000

    assert len(results) == len(expected_records)

    paired = diagnosed = 0
    wrong = []
    for result in results:
        entry = truth[result.record_id]
        if result.settlement_id == entry.settlement_id:
            paired += 1
        if result.primary_cause is entry.primary_cause:
            diagnosed += 1
        else:
            wrong.append((result.record_id, entry.primary_cause.value, result.primary_cause.value))

    for record_id, expected_cause, got in wrong:
        print(f"[reconciler] {record_id}: expected {expected_cause}, got {got}")

    assert not wrong, f"{len(wrong)} records misdiagnosed"
    assert paired == len(results), f"only {paired}/{len(results)} paired"

    # Every record must carry a trace and prose, or the UI has nothing to show.
    for result in results:
        assert result.trace, f"{result.record_id} has no trace"
        assert result.explanation.strip(), f"{result.record_id} has no explanation"
        assert "MATCHED_PREFIX" not in result.explanation

    # The trace must record what actually happened, not a fixed script.
    unmatched = [r for r in results if r.settlement_id is None]
    assert all(r.trace[-1].step == "days_awaiting_settlement" for r in unmatched)
    assert all(r.trace[-1].step == "check_arithmetic_causes" for r in results if r.settlement_id)

    # No model was called. Anything importing an LLM client here is a regression.
    import sys
    assert "agent.reasoning_agent" not in sys.modules, "the deterministic path pulled in the agent"

    print(
        f"[reconciler] ok - {paired}/{len(results)} paired, {diagnosed}/{len(results)} diagnosed, "
        f"{elapsed_ms:.1f}ms, no model calls"
    )
