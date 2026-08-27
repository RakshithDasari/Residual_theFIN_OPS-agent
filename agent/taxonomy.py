"""The ten discrepancy causes, written for the agent to read.

`DiscrepancyCause` in data/schemas.py is a data shape. This is the domain knowledge
that goes with it: for each cause, a label for the UI and the signature that
identifies it in the evidence a tool returns.

Signatures describe how each cause behaves in reality, not the ranges the synthetic
batch happens to use. Statutory rates appear because a finance controller would know
them; the invented pricing tiers and random spreads used to build the test data do not.
Nothing here imports from the data generator, so the answer key has no path into the
prompt.

Run from the project root:  python -m agent.taxonomy
"""

from typing import NamedTuple

from data.schemas import DiscrepancyCause


class Cause(NamedTuple):
    label: str
    signature: str


CAUSES = {
    DiscrepancyCause.MDR_FEE: Cause(
        "Processing fee",
        "residual_paise is 0. The processing fee and the GST on it, both stated on the "
        "settlement, account for the entire gap between expected and actual. Nothing is "
        "missing; the merchant booked the gross figure and Razorpay settled the net.",
    ),
    DiscrepancyCause.GST_ON_FEE: Cause(
        "GST on processing fee",
        "residual_paise is negative and equals exactly minus fees_paise. The merchant's "
        "expected figure was already net of the processing fee, so subtracting the fee "
        "again double-counted it. What they had not accounted for is the 18% GST charged "
        "on that fee. Note this GST is on the fee, never on the sale.",
    ),
    DiscrepancyCause.TDS: Cause(
        "TDS withheld",
        "residual_paise is positive and equals reference_amounts.tds_at_1pct_paise. Tax "
        "deducted at source under s.194-O: 1% of gross, withheld by the platform and paid "
        "to the government for the merchant. Not lost money, recoverable when they file.",
    ),
    DiscrepancyCause.PARTIAL_REFUND: Cause(
        "Partial refund",
        "residual_paise is positive, is a material share of the order value, and matches "
        "none of the statutory reference amounts. Part of the sale was returned to the "
        "customer after the original payment, so there was less left to settle. Common on "
        "ecommerce returns and cancelled bookings.",
    ),
    DiscrepancyCause.FX_MARKUP: Cause(
        "Currency conversion markup",
        "residual_paise is positive and equals reference_amounts.fx_markup_at_3pct_paise. "
        "A cross-border payment converted at a 3% markup over the reference rate.",
    ),
    DiscrepancyCause.IN_TRANSIT: Cause(
        "In transit",
        "No settlement exists for this record, and the order is recent enough to still be "
        "inside Razorpay's T+2 settlement window. This is not an exception. The money is "
        "on its way and no action is needed. Only the age of the order separates this from "
        "dispute_hold, so establish that age before choosing between them.",
    ),
    DiscrepancyCause.DISPUTE_HOLD: Cause(
        "Held for dispute",
        "No settlement exists, and the order is well past the T+2 window, so settlement "
        "was due days ago and never arrived. Funds are being withheld pending a chargeback "
        "or dispute. This one does need the merchant's attention.",
    ),
    DiscrepancyCause.ROUNDING_DRIFT: Cause(
        "Rounding drift",
        "within_rounding_tolerance is true: the residual is one or two paise. Percentage "
        "deductions stacked on each other each round to the nearest paise and the "
        "remainders do not cancel. Harmless, but say so rather than leaving a gap "
        "unexplained.",
    ),
    DiscrepancyCause.UTR_MISMATCH: Cause(
        "Reference mismatch",
        "The reference did not match any settlement exactly, but a fuzzy match paired it, "
        "and once paired the amount reconciles. A reference problem, not a money problem: "
        "the merchant's system stored a truncated or garbled copy of the bank UTR.",
    ),
    DiscrepancyCause.UNRESOLVED: Cause(
        "Unresolved",
        "The residual is material but matches no cause above. Report it as unresolved and "
        "state the residual. This is the right answer, not a failure. A confident wrong "
        "explanation costs the merchant more than an honest gap does.",
    ),
}


def as_prompt_block():
    """The taxonomy as the agent sees it. Cause values are the vocabulary it must answer in."""
    return "\n".join(
        f"{cause.value} ({info.label})\n  {info.signature}" for cause, info in CAUSES.items()
    )


if __name__ == "__main__":
    assert list(CAUSES) == list(DiscrepancyCause), "taxonomy and enum are out of step"

    block = as_prompt_block()
    assert all(cause.value in block for cause in DiscrepancyCause)

    print(block)
    print(f"\n[taxonomy] ok - {len(CAUSES)} causes, {len(block)} chars of prompt")
