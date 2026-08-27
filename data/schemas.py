from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field, computed_field


class BusinessType(str, Enum):
    ECOMMERCE = "ecommerce"
    SAAS = "saas"
    BOOKINGS = "bookings"


class DiscrepancyCause(str, Enum):
    MDR_FEE = "mdr_fee"
    GST_ON_FEE = "gst_on_fee"
    TDS = "tds"
    PARTIAL_REFUND = "partial_refund"
    FX_MARKUP = "fx_markup"
    IN_TRANSIT = "in_transit"
    DISPUTE_HOLD = "dispute_hold"
    ROUNDING_DRIFT = "rounding_drift"
    UTR_MISMATCH = "utr_mismatch"
    UNRESOLVED = "unresolved"


class RecordStatus(str, Enum):
    MATCHED = "matched"
    EXPLAINED = "explained"
    IN_TRANSIT = "in_transit"
    UNRESOLVED = "unresolved"


class SettlementRecord(BaseModel):
    """The 'actual' side — mirrors Razorpay's Settlement entity. Money that
    genuinely landed in the merchant's bank account."""

    settlement_id: str = Field(..., description="Razorpay settlement ID, e.g. 'setl_XXXXXXXXXXXXXX'")
    amount_paise: int = Field(..., description="Net amount settled after deductions, in paise")
    fees_paise: int = Field(..., description="Razorpay processing fee (MDR), in paise")
    tax_paise: int = Field(..., description="GST charged on the processing fee, not on the sale, in paise")
    utr: str = Field(..., description="Bank-side unique transaction reference")
    created_at: datetime
    status: str = "processed"


class ExpectedRecord(BaseModel):
    """The 'expected' side — stands in for a merchant's own order/invoice system.
    Field names deliberately do not match SettlementRecord; bridging that
    mismatch is what reconciliation actually is."""

    record_id: str = Field(..., description="Merchant's own order/invoice ID")
    expected_amount_paise: int = Field(..., description="Gross amount the merchant expected to receive, in paise")
    reference_hint: str = Field(..., description="Merchant's reference — may be truncated or altered relative to the settlement UTR")
    business_type: BusinessType
    created_at: datetime = Field(..., description="When the order was placed, not when it settled")
    linked_settlement_id: Optional[str] = Field(
        default=None,
        exclude=True,
        description="True pairing, for the generator and eval only. Excluded from serialisation so it never reaches the agent.",
    )


class GroundTruthEntry(BaseModel):
    """Answer key. Written to ground_truth.json, read only by evaluation/eval.py."""

    record_id: str
    primary_cause: DiscrepancyCause
    contributing_causes: list[DiscrepancyCause] = Field(default_factory=list)
    settlement_id: Optional[str] = Field(
        default=None,
        description="Correct pairing. None means the record legitimately has no settlement yet, "
        "which is itself the right answer for in_transit and dispute_hold.",
    )

    @property
    def is_genuinely_unresolved(self) -> bool:
        return self.primary_cause is DiscrepancyCause.UNRESOLVED


class TraceStep(BaseModel):
    """One tool call the agent chose to make, as the drilldown timeline shows it."""

    step: str
    result: str
    detail: str


class ReconciledRecord(BaseModel):
    """One record after the agent is done with it. This is what the API returns.

    Lives here rather than with the agent so the report builder and the API can read a
    result without importing an LLM client.
    """

    record_id: str
    business_type: BusinessType
    expected_amount_paise: int
    actual_amount_paise: Optional[int] = Field(default=None, description="None when no settlement was found")
    settlement_id: Optional[str] = Field(default=None, description="What the agent paired this to, for pairing accuracy")
    primary_cause: DiscrepancyCause
    contributing_causes: list[DiscrepancyCause] = Field(default_factory=list)
    explanation: str
    confidence: float = Field(..., ge=0.0, le=1.0)
    trace: list[TraceStep] = Field(default_factory=list)

    @computed_field
    @property
    def status(self) -> RecordStatus:
        """Derived, so it cannot disagree with the cause the agent actually reported."""
        if self.primary_cause is DiscrepancyCause.UNRESOLVED:
            return RecordStatus.UNRESOLVED
        if self.primary_cause is DiscrepancyCause.IN_TRANSIT:
            return RecordStatus.IN_TRANSIT
        # Both of these leave no residual: the fee was the whole story, or only the
        # reference was wrong. Nothing about the money needs explaining.
        if self.primary_cause in (DiscrepancyCause.MDR_FEE, DiscrepancyCause.UTR_MISMATCH):
            return RecordStatus.MATCHED
        return RecordStatus.EXPLAINED


if __name__ == "__main__":
    settlement = SettlementRecord(
        settlement_id="setl_TESTONLY000001",
        amount_paise=98_230,
        fees_paise=1_500,
        tax_paise=270,
        utr="UTR2026081912345",
        created_at=datetime(2026, 8, 19, 11, 30),
    )
    expected = ExpectedRecord(
        record_id="ORD-1001",
        expected_amount_paise=100_000,
        reference_hint="UTR20260819",
        business_type=BusinessType.ECOMMERCE,
        created_at=datetime(2026, 8, 17, 9, 15),
        linked_settlement_id=settlement.settlement_id,
    )

    # The answer key must never survive serialisation into anything the agent reads,
    # but must stay readable in-process for the generator and eval.
    assert "linked_settlement_id" not in expected.model_dump()
    assert "linked_settlement_id" not in expected.model_dump_json()
    assert expected.linked_settlement_id == "setl_TESTONLY000001"

    assert (
        expected.expected_amount_paise
        - settlement.fees_paise
        - settlement.tax_paise
        == settlement.amount_paise
    )

    truth = GroundTruthEntry(
        record_id="ORD-1001",
        primary_cause=DiscrepancyCause.MDR_FEE,
        contributing_causes=[DiscrepancyCause.GST_ON_FEE],
        settlement_id=settlement.settlement_id,
    )
    assert not truth.is_genuinely_unresolved
    assert GroundTruthEntry(
        record_id="ORD-9999", primary_cause=DiscrepancyCause.UNRESOLVED
    ).is_genuinely_unresolved
    assert truth.model_dump(mode="json")["primary_cause"] == "mdr_fee"

    reconciled = ReconciledRecord(
        record_id="ORD-1001",
        business_type=BusinessType.ECOMMERCE,
        expected_amount_paise=100_000,
        actual_amount_paise=98_230,
        settlement_id=settlement.settlement_id,
        primary_cause=DiscrepancyCause.MDR_FEE,
        contributing_causes=[DiscrepancyCause.GST_ON_FEE],
        explanation="Nothing is missing.",
        confidence=0.97,
        trace=[TraceStep(step="try_exact_match", result="found", detail="UTRs are identical")],
    )
    assert reconciled.model_dump()["status"] is RecordStatus.MATCHED
    assert reconciled.model_dump(mode="json")["status"] == "matched"

    def status_for(cause):
        return reconciled.model_copy(update={"primary_cause": cause}).status

    assert status_for(DiscrepancyCause.UTR_MISMATCH) is RecordStatus.MATCHED
    assert status_for(DiscrepancyCause.TDS) is RecordStatus.EXPLAINED
    assert status_for(DiscrepancyCause.DISPUTE_HOLD) is RecordStatus.EXPLAINED
    assert status_for(DiscrepancyCause.IN_TRANSIT) is RecordStatus.IN_TRANSIT
    assert status_for(DiscrepancyCause.UNRESOLVED) is RecordStatus.UNRESOLVED

    print("[schemas] ok")
