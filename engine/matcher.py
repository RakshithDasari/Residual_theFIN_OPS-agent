"""Deterministic pairing and arithmetic reconciliation.

Pure functions only — nothing here knows an agent exists. agent/tools.py wraps these
for the orchestrator to call.

Run from the project root:  python -m engine.matcher
"""

from rapidfuzz.distance import Levenshtein

from data.schemas import ExpectedRecord, SettlementRecord

GST_RATE = 0.18  # GST charged on the processing fee, not on the sale
TDS_RATE = 0.01  # s.194-O, deducted on gross
FX_MARKUP_RATE = 0.03  # cross-border conversion markup
ROUNDING_TOLERANCE_PAISE = 2

MAX_DROPPED_CHARS = 4
MAX_REFERENCE_EDITS = 2


def try_exact_match(expected, settlements):
    """Return the settlement whose UTR equals the merchant's reference exactly, or None."""
    # Linear scan is fine for a 50-record batch. A production feed would index by UTR.
    for settlement in settlements:
        if settlement.utr == expected.reference_hint:
            return settlement
    return None


def try_fuzzy_match(
    expected, settlements, max_dropped=MAX_DROPPED_CHARS, max_edits=MAX_REFERENCE_EDITS
):
    """Pair a reference that is a truncation of, or a couple of edits from, a real UTR.

    Returns (settlement, detail). `detail` gives the basis for the match, or the reason
    none was made, and is what the audit trail shows the user.

    Structural tests rather than a similarity score, because scores do not separate here:
    every UTR shares a prefix and a date, so fuzz.ratio rates an unrelated same-day
    settlement (87.5) nearly as high as a genuine truncation (89.7), and a runner-up
    margin is worse still — measured wider for coincidences than for real matches.
    Truncation is a prefix relation and a garbled digit is a bounded edit distance.
    Both separate cleanly.

    Ceiling: with 5 random digits per UTR, coincidental same-length neighbours sit at
    edit distance 3+ across a 50-record batch. Over millions of settlements they would
    reach distance 2, and pairing would need the amount as a second signal.
    """
    reference = expected.reference_hint
    candidates = []

    for settlement in settlements:
        utr = settlement.utr
        dropped = len(utr) - len(reference)
        if 0 < dropped <= max_dropped and utr.startswith(reference):
            candidates.append(
                (settlement, f"reference is the first {len(reference)} characters of UTR {utr}")
            )
        elif dropped == 0:
            edits = Levenshtein.distance(reference, utr)
            if edits <= max_edits:
                candidates.append(
                    (settlement, f"reference differs from UTR {utr} by {edits} character(s)")
                )

    if not candidates:
        return None, "no settlement reference is a truncation or near-miss of this one"
    if len(candidates) > 1:
        utrs = ", ".join(s.utr for s, _ in candidates)
        return None, f"ambiguous - {len(candidates)} settlements could match this reference: {utrs}"
    return candidates[0]


def check_arithmetic_causes(expected, settlement):
    """Reconstruct the gap between expected and actual from the deductions on record.

    Returns evidence, not a conclusion. The caller compares `residual_paise` against
    `reference_amounts` and decides what it means.

    Sign convention: residual > 0 means more was taken than fees and tax account for.
    residual < 0 means we over-subtracted, which happens when the merchant's expected
    figure was already net of the processing fee.
    """
    gross = expected.expected_amount_paise
    predicted_net = gross - settlement.fees_paise - settlement.tax_paise
    residual = predicted_net - settlement.amount_paise

    return {
        "expected_amount_paise": gross,
        "actual_amount_paise": settlement.amount_paise,
        "fees_paise": settlement.fees_paise,
        "tax_paise": settlement.tax_paise,
        "predicted_net_paise": predicted_net,
        "residual_paise": residual,
        "residual_pct_of_expected": round(100 * residual / gross, 4) if gross else 0.0,
        "gst_correctly_charged": settlement.tax_paise == round(settlement.fees_paise * GST_RATE),
        "within_rounding_tolerance": 0 < abs(residual) <= ROUNDING_TOLERANCE_PAISE,
        "settlement_lag_days": (settlement.created_at - expected.created_at).days,
        "reference_amounts": {
            "processing_fee_paise": settlement.fees_paise,
            "tds_at_1pct_paise": round(gross * TDS_RATE),
            "fx_markup_at_3pct_paise": round(gross * FX_MARKUP_RATE),
        },
    }


def days_awaiting_settlement(expected, as_of):
    """Age of an unsettled order. Date arithmetic the model should not be doing itself."""
    return (as_of - expected.created_at).days


if __name__ == "__main__":
    import json
    from pathlib import Path

    from data.schemas import DiscrepancyCause, GroundTruthEntry

    data_dir = Path(__file__).resolve().parent.parent / "data"
    batch = json.loads((data_dir / "synthetic_batch.json").read_text())
    expected_records = [ExpectedRecord(**r) for r in batch["expected_records"]]
    settlements = [SettlementRecord(**s) for s in batch["settlements"]]
    truth = {
        t["record_id"]: GroundTruthEntry(**t)
        for t in json.loads((data_dir / "ground_truth.json").read_text())
    }

    exact_hits = fuzzy_hits = 0
    for expected in expected_records:
        cause = truth[expected.record_id].primary_cause
        correct_id = truth[expected.record_id].settlement_id

        exact = try_exact_match(expected, settlements)
        fuzzy, detail = try_fuzzy_match(expected, settlements)

        if cause in (DiscrepancyCause.IN_TRANSIT, DiscrepancyCause.DISPUTE_HOLD):
            assert exact is None, f"{expected.record_id} has no settlement but matched one"
            assert fuzzy is None, f"{expected.record_id} has no settlement but fuzzy-matched: {detail}"
            continue

        if cause is DiscrepancyCause.UTR_MISMATCH:
            assert exact is None, f"{expected.record_id} should not match exactly"
            assert fuzzy is not None, f"{expected.record_id} should fuzzy-match: {detail}"
            assert fuzzy.settlement_id == correct_id, f"{expected.record_id} fuzzy-paired wrongly"
            fuzzy_hits += 1
            matched = fuzzy
        else:
            assert exact is not None, f"{expected.record_id} should match exactly"
            assert exact.settlement_id == correct_id, f"{expected.record_id} paired wrongly"
            exact_hits += 1
            matched = exact

        evidence = check_arithmetic_causes(expected, matched)
        residual = evidence["residual_paise"]
        assert evidence["gst_correctly_charged"], f"{expected.record_id} GST is not 18% of the fee"

        if cause in (DiscrepancyCause.MDR_FEE, DiscrepancyCause.UTR_MISMATCH):
            assert residual == 0, f"{expected.record_id} should reconcile exactly, off by {residual}"
        elif cause is DiscrepancyCause.GST_ON_FEE:
            assert residual == -evidence["fees_paise"], f"{expected.record_id} residual {residual}"
        elif cause is DiscrepancyCause.ROUNDING_DRIFT:
            assert evidence["within_rounding_tolerance"], f"{expected.record_id} drift {residual}"
        elif cause is DiscrepancyCause.TDS:
            assert residual == evidence["reference_amounts"]["tds_at_1pct_paise"]
        elif cause is DiscrepancyCause.FX_MARKUP:
            assert residual == evidence["reference_amounts"]["fx_markup_at_3pct_paise"]
        elif cause is DiscrepancyCause.PARTIAL_REFUND:
            assert residual > 0, f"{expected.record_id} refund should reduce the settlement"

    assert exact_hits + fuzzy_hits == 48
    print(f"matcher ok - {exact_hits} exact, {fuzzy_hits} fuzzy, all 48 pairings correct")
