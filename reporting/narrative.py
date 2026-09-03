"""Plain-language explanations written from tool evidence, with no model in the loop.

One writer per cause, each saying what happened, how much it was, and what the merchant
should do — including that they need do nothing when nothing is wrong. The agent writes
its own prose; this is what the deterministic path uses instead, and what the UI shows
when the batch is reconciled without a model.

Amounts arrive as integer paise and are formatted to rupees for display only.

Run from the project root:  python -m reporting.narrative
"""

from data.schemas import DiscrepancyCause

T_PLUS_DAYS = 2


def rupees(paise: int) -> str:
    """Paise to a rupee string with thousands separators. The only float in the project."""
    return f"Rs {abs(paise) / 100:,.2f}"


def _matched(cause, evidence, expected_paise) -> str:
    residual = evidence["residual_paise"]
    fees = evidence["fees_paise"]
    tax = evidence["tax_paise"]
    actual = evidence["actual_amount_paise"]

    if cause is DiscrepancyCause.MDR_FEE:
        return (
            f"This settlement is correct and needs no action. You expected "
            f"{rupees(expected_paise)} and received {rupees(actual)}; the difference is the "
            f"{rupees(fees)} processing fee plus {rupees(tax)} GST on that fee, both shown on "
            f"the settlement. You booked the gross amount and Razorpay settled the net."
        )

    if cause is DiscrepancyCause.GST_ON_FEE:
        return (
            f"Your expected figure of {rupees(expected_paise)} was already net of the "
            f"{rupees(fees)} processing fee, so the fee looks deducted twice when you compare "
            f"the two. What was not accounted for is the {rupees(tax)} GST charged on that fee "
            f"— note the GST is on the fee, not on your sale. No money is missing."
        )

    if cause is DiscrepancyCause.TDS:
        return (
            f"{rupees(residual)} was withheld as TDS under section 194-O, which is 1% of the "
            f"gross order value. This is not lost money: Razorpay pays it to the government "
            f"against your PAN and you claim it back when you file. Keep the settlement "
            f"reference for your return."
        )

    if cause is DiscrepancyCause.FX_MARKUP:
        return (
            f"{rupees(residual)} of the gap is the 3% currency conversion markup on a "
            f"cross-border payment, charged over the reference exchange rate. Expect this on "
            f"every international order; if the volume is material, it is worth asking "
            f"Razorpay about your FX pricing."
        )

    if cause is DiscrepancyCause.PARTIAL_REFUND:
        pct = evidence["residual_pct_of_expected"]
        return (
            f"{rupees(residual)} is missing beyond the stated fees and tax, which is {pct:.1f}% "
            f"of the order. That is consistent with part of this sale being refunded to the "
            f"customer after the original payment, leaving less to settle. Check this order "
            f"against your refund log to confirm the amount."
        )

    if cause is DiscrepancyCause.ROUNDING_DRIFT:
        return (
            f"The gap is {rupees(residual)} — a rounding artefact, not a real shortfall. "
            f"Percentage deductions each round to the nearest paise and the remainders do not "
            f"always cancel. No action needed; it is noted so the difference is not left "
            f"unexplained in your books."
        )

    if cause is DiscrepancyCause.UTR_MISMATCH:
        return (
            f"The money is correct and fully reconciled at {rupees(actual)}; only the reference "
            f"was wrong. Your system stored a truncated or altered copy of the bank UTR, so an "
            f"exact lookup failed and this was paired on the reference instead. Worth fixing "
            f"how the reference is captured, but nothing is owed to you."
        )

    return (
        f"{rupees(residual)} of this settlement cannot be explained by the fees and tax on "
        f"record, and it does not match TDS, an FX markup, or a rounding artefact. We are "
        f"flagging it rather than guessing. Raise this settlement with Razorpay support "
        f"quoting the reference above."
    )


def _unmatched(cause, expected_paise, days) -> str:
    if cause is DiscrepancyCause.IN_TRANSIT:
        return (
            f"No settlement has arrived for this {rupees(expected_paise)} order yet, but it was "
            f"placed {days} days ago and Razorpay settles on a T+{T_PLUS_DAYS} cycle. This is "
            f"not an exception and no action is needed — the money is still on its way."
        )

    return (
        f"This {rupees(expected_paise)} order was placed {days} days ago and settlement was due "
        f"after T+{T_PLUS_DAYS}, so it is well overdue with no settlement on record. Funds are "
        f"most likely held pending a chargeback or dispute. This one needs you to raise it with "
        f"Razorpay support."
    )


def narrate(cause, evidence, expected_paise: int, days: int = 0) -> str:
    """The explanation for one record. `evidence` is None when nothing was paired."""
    if evidence is None:
        return _unmatched(cause, expected_paise, days)
    return _matched(cause, evidence, expected_paise)


if __name__ == "__main__":
    import json
    import re
    from datetime import datetime

    from config import BATCH_FILE
    from data.schemas import ExpectedRecord, SettlementRecord
    from engine import matcher

    assert rupees(8360) == "Rs 83.60"
    assert rupees(-8360) == "Rs 83.60", "sign is carried by the sentence, not the amount"
    assert rupees(123456789) == "Rs 1,234,567.89"

    batch = json.loads(BATCH_FILE.read_text())
    expected = ExpectedRecord(**batch["expected_records"][0])
    settlements = [SettlementRecord(**s) for s in batch["settlements"]]
    settlement = matcher.try_exact_match(expected, settlements)
    evidence = matcher.check_arithmetic_causes(expected, settlement)

    matched_causes = [c for c in DiscrepancyCause if c not in (DiscrepancyCause.IN_TRANSIT, DiscrepancyCause.DISPUTE_HOLD)]
    for cause in matched_causes:
        prose = narrate(cause, evidence, expected.expected_amount_paise)
        assert re.search(r"Rs [\d,]+\.\d\d", prose), f"{cause.value} quotes no amount"
        assert len(prose.split()) >= 25, f"{cause.value} is too thin to be useful"
        assert cause.value not in prose, f"{cause.value} leaks the enum value into merchant prose"

    for cause, days in ((DiscrepancyCause.IN_TRANSIT, 1), (DiscrepancyCause.DISPUTE_HOLD, 9)):
        prose = narrate(cause, None, expected.expected_amount_paise, days=days)
        assert re.search(r"Rs [\d,]+\.\d\d", prose), f"{cause.value} quotes no amount"
        assert f"{days} days ago" in prose, f"{cause.value} does not say how old the order is"

    # The two no-action causes must say so, and the two urgent ones must not.
    assert "no action is needed" in narrate(DiscrepancyCause.IN_TRANSIT, None, 100000, days=1)
    assert "needs you to raise it" in narrate(DiscrepancyCause.DISPUTE_HOLD, None, 100000, days=9)
    assert "needs no action" in narrate(DiscrepancyCause.MDR_FEE, evidence, expected.expected_amount_paise)
    assert "support" in narrate(DiscrepancyCause.UNRESOLVED, evidence, expected.expected_amount_paise)

    print(f"[narrative] ok - all {len(DiscrepancyCause)} causes narrate with an amount")
