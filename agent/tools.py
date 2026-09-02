from context import get_current_record
from engine import matcher

MATCHED_PREFIX = "Matched settlement"
MATCH_TOOLS = ("try_exact_match", "try_fuzzy_match")

# Every tool takes record_hint and ignores it. The record under reconciliation comes from
# context, so a model-supplied reference cannot reach the matcher.


def _as_text(evidence: dict) -> str:
    lines = []
    for key, value in evidence.items():
        if isinstance(value, dict):
            lines.append(f"{key}:")
            lines.extend(f"  {k}: {v}" for k, v in value.items())
        else:
            lines.append(f"{key}: {value}")
    return "\n".join(lines)


def try_exact_match(record_hint: str = "") -> str:
    """Find the settlement whose bank UTR is exactly this record's reference."""
    record = get_current_record()
    settlement = matcher.try_exact_match(record.expected, record.settlements)
    if settlement is None:
        return f"No settlement has a UTR equal to this reference ({record.expected.reference_hint})."

    record.matched = settlement
    return (
        f"{MATCHED_PREFIX} {settlement.settlement_id}. Its UTR is exactly the reference "
        f"on this record ({settlement.utr})."
    )


def try_fuzzy_match(record_hint: str = "") -> str:
    """Find the settlement whose UTR this reference is a truncation of, or is a character
    or two away from, and report the basis for the match."""
    record = get_current_record()
    settlement, detail = matcher.try_fuzzy_match(record.expected, record.settlements)
    if settlement is None:
        return f"No match: {detail}."

    record.matched = settlement
    return f"{MATCHED_PREFIX} {settlement.settlement_id}: {detail}."


def check_arithmetic_causes(record_hint: str = "") -> str:
    """Break the gap between the expected amount and the settled amount into the fee and
    GST on record, the residual left over, and what TDS and FX markup would come to."""
    record = get_current_record()
    if record.matched is None:
        return "No settlement is paired with this record yet, so there is nothing to reconcile against."

    evidence = matcher.check_arithmetic_causes(record.expected, record.matched)
    rupees = evidence["residual_paise"] / 100
    return (
        f"Reconciled against settlement {record.matched.settlement_id}.\n"
        f"{_as_text(evidence)}\n"
        f"residual_in_rupees: {rupees:.2f}"
    )


def days_awaiting_settlement(record_hint: str = "") -> str:
    """Report how many days this order has been waiting, for records with no settlement."""
    record = get_current_record()
    days = matcher.days_awaiting_settlement(record.expected, record.as_of)
    return (
        f"This order was placed {days} days ago and no settlement exists for it. "
        f"Razorpay settles on a T+2 cycle."
    )


if __name__ == "__main__":
    import json
    from datetime import datetime

    from agno.tools.function import Function

    from config import BATCH_FILE, GROUND_TRUTH_FILE
    from context import set_current_record
    from data.schemas import DiscrepancyCause, ExpectedRecord, GroundTruthEntry, SettlementRecord

    batch = json.loads(BATCH_FILE.read_text())
    expected_records = [ExpectedRecord(**r) for r in batch["expected_records"]]
    settlements = [SettlementRecord(**s) for s in batch["settlements"]]
    truth = {
        t["record_id"]: GroundTruthEntry(**t)
        for t in json.loads(GROUND_TRUTH_FILE.read_text())
    }
    as_of = datetime(2026, 8, 24)

    tools = [try_exact_match, try_fuzzy_match, check_arithmetic_causes, days_awaiting_settlement]

    for tool in tools:
        schema = Function.from_callable(tool)
        assert schema.description, f"{schema.name} has no docstring, so the model gets no description"
        assert "record_hint" in schema.parameters["properties"], schema.parameters
        assert "record_hint" not in schema.parameters.get("required", []), (
            f"{schema.name} must not require an argument"
        )

    assert all(name in {t.__name__ for t in tools} for name in MATCH_TOOLS)

    paired = 0
    for expected in expected_records:
        cause = truth[expected.record_id].primary_cause
        record = set_current_record(expected, settlements, as_of)

        assert "nothing to reconcile" in check_arithmetic_causes()

        if MATCHED_PREFIX not in try_exact_match():
            fuzzy = try_fuzzy_match()
            if record.matched is None:
                assert MATCHED_PREFIX not in fuzzy
                assert cause in (DiscrepancyCause.IN_TRANSIT, DiscrepancyCause.DISPUTE_HOLD), (
                    f"{expected.record_id} found no settlement but its cause is {cause.value}"
                )
                assert "days ago" in days_awaiting_settlement()
                continue
            assert cause is DiscrepancyCause.UTR_MISMATCH

        assert record.matched.settlement_id == truth[expected.record_id].settlement_id
        paired += 1

        report = check_arithmetic_causes()
        assert "residual_paise:" in report and "tds_at_1pct_paise:" in report
        assert DiscrepancyCause.MDR_FEE.value not in report, "tools must not name a cause"

    assert paired == 48

    # record_hint is ignored by the matcher. Point it at a real settlement that belongs to
    # another record and the answer must not move.
    set_current_record(expected_records[0], settlements, as_of)
    honest = try_exact_match()
    assert try_exact_match(settlements[7].utr) == honest, "record_hint changed the pairing"
    assert try_exact_match("garbage") == honest, "record_hint changed the pairing"

    print(f"[tools] ok - {paired} records paired, {len(tools)} tools accept ignored record_hint")
