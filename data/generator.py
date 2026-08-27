"""Generates the synthetic reconciliation batch and its answer key.

Run from the project root:  python -m data.generator

Writes two files side by side in this directory:
  synthetic_batch.json  — what the matcher and agent see
  ground_truth.json     — what only evaluation/eval.py reads
"""

import collections
import json
import random
import string
from datetime import datetime, timedelta
from pathlib import Path

from data.schemas import (
    BusinessType,
    DiscrepancyCause,
    ExpectedRecord,
    GroundTruthEntry,
    SettlementRecord,
)
from engine.matcher import (
    FX_MARKUP_RATE,
    GST_RATE,
    ROUNDING_TOLERANCE_PAISE,
    TDS_RATE,
)

BATCH_DATE = datetime(2026, 8, 24)
SETTLEMENT_LAG = timedelta(days=2)

# Statutory rates live in engine.matcher, which is the code that has to recognise them
# in real settlement data. Declaring them here too would let the two drift apart, and a
# mismatch would read as agent failure in eval rather than as a constant out of step.
MDR_RATES = (0.0175, 0.02, 0.0236)  # our own pricing tiers, not tax — matcher reads fees off the record
DRIFT_PAISE = [d for d in range(-ROUNDING_TOLERANCE_PAISE, ROUNDING_TOLERANCE_PAISE + 1) if d]

# Every cause appears at least twice, otherwise eval has nothing to score it on.
CAUSE_MIX = {
    DiscrepancyCause.MDR_FEE: 22,
    DiscrepancyCause.GST_ON_FEE: 3,
    DiscrepancyCause.TDS: 4,
    DiscrepancyCause.PARTIAL_REFUND: 5,
    DiscrepancyCause.FX_MARKUP: 4,
    DiscrepancyCause.IN_TRANSIT: 4,
    DiscrepancyCause.DISPUTE_HOLD: 3,
    DiscrepancyCause.ROUNDING_DRIFT: 4,
    DiscrepancyCause.UTR_MISMATCH: 4,
    DiscrepancyCause.UNRESOLVED: 2,
}

# prefix, min gross, max gross — in paise
VERTICALS = {
    BusinessType.ECOMMERCE: ("ORD", 30_000, 800_000),
    BusinessType.SAAS: ("INV", 99_900, 2_499_900),
    BusinessType.BOOKINGS: ("BKG", 150_000, 4_500_000),
}

NO_SETTLEMENT = (DiscrepancyCause.IN_TRANSIT, DiscrepancyCause.DISPUTE_HOLD)
STANDARD_DEDUCTIONS = [DiscrepancyCause.MDR_FEE, DiscrepancyCause.GST_ON_FEE]


def _settlement_id(rng):
    return "setl_" + "".join(rng.choices(string.ascii_uppercase + string.digits, k=14))


def _utr(rng, when):
    return f"UTR{when:%Y%m%d}{rng.randint(10_000, 99_999)}"


def _mangle(rng, utr):
    """Truncated or transposed reference, as a merchant's own system might hold it."""
    if rng.random() < 0.5:
        return utr[:-3]
    i = rng.randrange(3, len(utr) - 1)
    return utr[:i] + utr[i + 1] + utr[i] + utr[i + 2 :]


def _build(rng, index, cause, business_type):
    prefix, low, high = VERTICALS[business_type]
    gross = rng.randrange(low, high, 100)
    record_id = f"{prefix}-{1000 + index}"

    if cause is DiscrepancyCause.IN_TRANSIT:
        ordered_at = BATCH_DATE - timedelta(days=rng.randint(0, 1), hours=rng.randint(1, 20))
    elif cause is DiscrepancyCause.DISPUTE_HOLD:
        ordered_at = BATCH_DATE - timedelta(days=rng.randint(10, 25))
    else:
        ordered_at = BATCH_DATE - timedelta(days=rng.randint(3, 30), hours=rng.randint(0, 23))

    if cause in NO_SETTLEMENT:
        expected = ExpectedRecord(
            record_id=record_id,
            expected_amount_paise=gross,
            reference_hint=_utr(rng, ordered_at),
            business_type=business_type,
            created_at=ordered_at,
        )
        return expected, None, GroundTruthEntry(record_id=record_id, primary_cause=cause)

    fees = round(gross * rng.choice(MDR_RATES))
    tax = round(fees * GST_RATE)
    net = gross - fees - tax
    expected_amount = gross
    contributing = list(STANDARD_DEDUCTIONS)

    if cause is DiscrepancyCause.MDR_FEE:
        contributing = [DiscrepancyCause.GST_ON_FEE]
    elif cause is DiscrepancyCause.GST_ON_FEE:
        # Merchant booked their expected figure net of MDR but forgot the GST charged
        # on that fee, so the residual they cannot account for is exactly the tax.
        expected_amount = gross - fees
        contributing = [DiscrepancyCause.MDR_FEE]
    elif cause is DiscrepancyCause.TDS:
        net -= round(gross * TDS_RATE)
    elif cause is DiscrepancyCause.PARTIAL_REFUND:
        net -= round(gross * rng.uniform(0.10, 0.40))
    elif cause is DiscrepancyCause.FX_MARKUP:
        net -= round(gross * FX_MARKUP_RATE)
    elif cause is DiscrepancyCause.ROUNDING_DRIFT:
        net += rng.choice(DRIFT_PAISE)
    elif cause is DiscrepancyCause.UNRESOLVED:
        # Deliberately matches no rate in the taxonomy, and not a round figure.
        net -= round(gross * rng.uniform(0.063, 0.079)) + rng.randint(1, 97)

    settled_at = ordered_at + SETTLEMENT_LAG + timedelta(hours=rng.randint(0, 10))
    utr = _utr(rng, settled_at)
    settlement = SettlementRecord(
        settlement_id=_settlement_id(rng),
        amount_paise=net,
        fees_paise=fees,
        tax_paise=tax,
        utr=utr,
        created_at=settled_at,
    )
    expected = ExpectedRecord(
        record_id=record_id,
        expected_amount_paise=expected_amount,
        reference_hint=_mangle(rng, utr) if cause is DiscrepancyCause.UTR_MISMATCH else utr,
        business_type=business_type,
        created_at=ordered_at,
        linked_settlement_id=settlement.settlement_id,
    )
    truth = GroundTruthEntry(
        record_id=record_id,
        primary_cause=cause,
        contributing_causes=contributing,
        settlement_id=settlement.settlement_id,
    )
    return expected, settlement, truth


def generate(seed=42):
    rng = random.Random(seed)
    causes = [cause for cause, count in CAUSE_MIX.items() for _ in range(count)]
    rng.shuffle(causes)

    # Dealt round-robin rather than drawn at random, so per-vertical accuracy is
    # measured on comparable sample sizes instead of whatever uniform draws gave us.
    names = list(VERTICALS)
    verticals = [names[i % len(names)] for i in range(len(causes))]
    rng.shuffle(verticals)

    expected_records, settlements, ground_truth = [], [], []
    for index, (cause, business_type) in enumerate(zip(causes, verticals)):
        expected, settlement, truth = _build(rng, index, cause, business_type)
        expected_records.append(expected)
        if settlement is not None:
            settlements.append(settlement)
        ground_truth.append(truth)

    # Settlements do not arrive in order. Without this, position alone would reveal
    # the correct pairing and the matcher could score well without matching.
    rng.shuffle(settlements)
    return expected_records, settlements, ground_truth


def write(directory=None):
    directory = directory or Path(__file__).parent
    expected_records, settlements, ground_truth = generate()

    (directory / "synthetic_batch.json").write_text(
        json.dumps(
            {
                "expected_records": [r.model_dump(mode="json") for r in expected_records],
                "settlements": [s.model_dump(mode="json") for s in settlements],
            },
            indent=2,
        )
    )
    (directory / "ground_truth.json").write_text(
        json.dumps([t.model_dump(mode="json") for t in ground_truth], indent=2)
    )
    return expected_records, settlements, ground_truth


if __name__ == "__main__":
    expected_records, settlements, ground_truth = write()
    batch = json.loads((Path(__file__).parent / "synthetic_batch.json").read_text())

    assert "linked_settlement_id" not in json.dumps(batch), "answer key leaked into the batch"
    assert len(expected_records) == sum(CAUSE_MIX.values()) == 55
    assert len(settlements) == 55 - CAUSE_MIX[DiscrepancyCause.IN_TRANSIT] - CAUSE_MIX[DiscrepancyCause.DISPUTE_HOLD]
    assert [r.record_id for r in expected_records] == [t.record_id for t in ground_truth]
    assert len({r.record_id for r in expected_records}) == 55

    seen = {t.primary_cause for t in ground_truth}
    assert seen == set(DiscrepancyCause), f"missing causes: {set(DiscrepancyCause) - seen}"

    per_vertical = collections.Counter(r.business_type for r in expected_records)
    assert len(per_vertical) == len(VERTICALS)
    assert max(per_vertical.values()) - min(per_vertical.values()) <= 1, per_vertical

    by_id = {s.settlement_id: s for s in settlements}
    for expected, truth in zip(expected_records, ground_truth):
        if truth.primary_cause in NO_SETTLEMENT:
            assert truth.settlement_id is None and expected.linked_settlement_id is None
            continue
        assert expected.linked_settlement_id == truth.settlement_id
        settlement = by_id[truth.settlement_id]
        residual = expected.expected_amount_paise - settlement.fees_paise - settlement.tax_paise - settlement.amount_paise
        if truth.primary_cause in (DiscrepancyCause.MDR_FEE, DiscrepancyCause.UTR_MISMATCH):
            # utr_mismatch is a reference problem, not a money problem — the amount
            # reconciles exactly, which is what makes fuzzy matching sufficient for it.
            assert residual == 0, f"{expected.record_id} should reconcile exactly, off by {residual}"
        elif truth.primary_cause is DiscrepancyCause.ROUNDING_DRIFT:
            assert 0 < abs(residual) <= 2, f"{expected.record_id} drift out of range: {residual}"
        else:
            assert residual != 0, f"{expected.record_id} has no discrepancy to explain"

    assert generate()[2] == ground_truth, "same seed must produce the same batch"

    unexplained = sum(1 for t in ground_truth if t.primary_cause is not DiscrepancyCause.MDR_FEE)
    print(f"batch ok - 55 records, {unexplained} needing more than standard deductions")
