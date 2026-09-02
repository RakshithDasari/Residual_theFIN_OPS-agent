import asyncio
from datetime import datetime, timedelta

from agent.reasoning_agent import reconcile_batch
from data.schemas import BusinessType, DiscrepancyCause, ExpectedRecord, SettlementRecord
from evaluation.eval import evaluate

AS_OF = datetime(2026, 8, 24)


def make_case(index, amount, cause, *, business_type=BusinessType.ECOMMERCE, reference=None, age_days=10, deduction="standard"):
    """Build one challenge record and its private evaluation label."""
    created_at = AS_OF - timedelta(days=age_days)
    settlement_id = f"setl_CHALLENGE_{index:02d}"
    utr = f"UTRCHALLENGE{index:02d}2026"
    fees = round(amount * 0.02)
    tax = round(fees * 0.18)
    net = amount - fees - tax
    expected_amount = amount

    if cause is DiscrepancyCause.GST_ON_FEE:
        expected_amount = amount - fees
    elif cause is DiscrepancyCause.TDS:
        net -= round(amount * 0.01)
    elif cause is DiscrepancyCause.FX_MARKUP:
        net -= round(amount * 0.03)
    elif cause is DiscrepancyCause.PARTIAL_REFUND:
        net -= round(amount * 0.35)
    elif cause is DiscrepancyCause.ROUNDING_DRIFT:
        net += 2
    elif cause is DiscrepancyCause.UNRESOLVED:
        net -= round(amount * 0.075) + 37
    elif cause is DiscrepancyCause.UTR_MISMATCH:
        reference = utr[:-3]
    elif cause in (DiscrepancyCause.IN_TRANSIT, DiscrepancyCause.DISPUTE_HOLD):
        if cause is DiscrepancyCause.IN_TRANSIT:
            created_at = AS_OF - timedelta(days=1, hours=4)
        else:
            created_at = AS_OF - timedelta(days=20)
        expected = ExpectedRecord(
            record_id=f"CH-{index:02d}",
            expected_amount_paise=amount,
            reference_hint=utr,
            business_type=business_type,
            created_at=created_at,
        )
        return expected, None, cause

    settlement = SettlementRecord(
        settlement_id=settlement_id,
        amount_paise=net,
        fees_paise=fees,
        tax_paise=tax,
        utr=utr,
        created_at=created_at + timedelta(days=2),
    )
    expected = ExpectedRecord(
        record_id=f"CH-{index:02d}",
        expected_amount_paise=expected_amount,
        reference_hint=reference or utr,
        business_type=business_type,
        created_at=created_at,
    )
    return expected, settlement, cause


def build_challenge():
    medium = [
        (1, 125_000, DiscrepancyCause.MDR_FEE),
        (2, 480_000, DiscrepancyCause.GST_ON_FEE),
        (3, 925_000, DiscrepancyCause.TDS),
        (4, 1_250_000, DiscrepancyCause.FX_MARKUP),
        (5, 760_000, DiscrepancyCause.PARTIAL_REFUND),
        (6, 315_000, DiscrepancyCause.ROUNDING_DRIFT),
        (7, 640_000, DiscrepancyCause.UTR_MISMATCH),
        (8, 350_000, DiscrepancyCause.IN_TRANSIT),
        (9, 2_100_000, DiscrepancyCause.DISPUTE_HOLD),
        (10, 510_000, DiscrepancyCause.UNRESOLVED),
    ]
    absurd = [
        (11, 99_999_900, DiscrepancyCause.MDR_FEE, BusinessType.SAAS),
        (12, 4_499_900, DiscrepancyCause.PARTIAL_REFUND, BusinessType.BOOKINGS),
        (13, 2_000_000, DiscrepancyCause.TDS, BusinessType.SAAS),
        (14, 3_333_300, DiscrepancyCause.FX_MARKUP, BusinessType.BOOKINGS),
        (15, 780_000, DiscrepancyCause.ROUNDING_DRIFT, BusinessType.ECOMMERCE),
        (16, 910_000, DiscrepancyCause.UNRESOLVED, BusinessType.ECOMMERCE),
        (17, 1_800_000, DiscrepancyCause.UTR_MISMATCH, BusinessType.SAAS),
        (18, 650_000, DiscrepancyCause.IN_TRANSIT, BusinessType.BOOKINGS),
        (19, 3_900_000, DiscrepancyCause.DISPUTE_HOLD, BusinessType.BOOKINGS),
        (20, 1_111_100, DiscrepancyCause.GST_ON_FEE, BusinessType.SAAS),
    ]
    cases = medium + absurd
    expected_records = []
    settlements = []
    truth = []
    for item in cases:
        index, amount, cause, *vertical = item
        expected, settlement, label = make_case(
            index, amount, cause, business_type=vertical[0] if vertical else BusinessType.ECOMMERCE
        )
        expected_records.append(expected)
        if settlement is not None:
            settlements.append(settlement)
        truth.append({"record_id": expected.record_id, "primary_cause": label.value, "settlement_id": settlement.settlement_id if settlement else None})
    return expected_records, settlements, truth


async def run():
    expected, settlements, truth_data = build_challenge()
    records = await reconcile_batch(expected, settlements, AS_OF)
    from data.schemas import GroundTruthEntry

    truth = [GroundTruthEntry(**entry) for entry in truth_data]
    metrics = evaluate(records, truth)
    print(f"[challenge] {metrics['records_evaluated']} records - pairing {metrics['pairing_accuracy']:.1%}, diagnosis {metrics['diagnosis_accuracy']:.1%}")
    print(f"[challenge] medium=10 absurd=10")
    return metrics


if __name__ == "__main__":
    asyncio.run(run())
