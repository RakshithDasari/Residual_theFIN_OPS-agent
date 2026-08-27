import os
from datetime import UTC, datetime
from typing import Any

import razorpay
from dotenv import load_dotenv

from data.schemas import SettlementRecord


def get_client() -> razorpay.Client:
    """Create an authenticated Razorpay client."""
    load_dotenv()
    key_id = os.getenv("RAZORPAY_KEY_ID")
    key_secret = os.getenv("RAZORPAY_KEY_SECRET")
    if not key_id or not key_secret:
        raise RuntimeError("Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in .env")
    return razorpay.Client(auth=(key_id, key_secret))


def to_settlement(record: dict[str, Any]) -> SettlementRecord:
    """Map a Razorpay settlement response into the app schema."""
    return SettlementRecord(
        settlement_id=record["id"],
        amount_paise=record["amount"],
        fees_paise=record["fees"],
        tax_paise=record["tax"],
        utr=record["utr"],
        created_at=datetime.fromtimestamp(record["created_at"], UTC),
        status=record["status"],
    )


def fetch_settlements(count: int = 100, skip: int = 0, client=None) -> list[SettlementRecord]:
    """Fetch one page of Razorpay settlements."""
    client = client or get_client()
    response = client.settlement.all({"count": count, "skip": skip})
    return [to_settlement(record) for record in response["items"]]


def fetch_recon_details(
    year: int,
    month: int,
    day: int | None = None,
    count: int = 100,
    skip: int = 0,
    client=None,
) -> dict[str, Any]:
    """Fetch Razorpay's settlement reconciliation report for a period."""
    client = client or get_client()
    params = {"year": year, "month": month, "count": count, "skip": skip}
    if day is not None:
        params["day"] = day
    return client.settlement.report(params)


if __name__ == "__main__":
    sample = {
        "id": "setl_DGlQ1Rj8os78Ec",
        "amount": 9973635,
        "status": "processed",
        "fees": 0,
        "tax": 0,
        "utr": "1568176960vxp0rj",
        "created_at": 1568176960,
    }

    class FakeSettlement:
        def all(self, params):
            assert params == {"count": 100, "skip": 0}
            return {"items": [sample]}

        def report(self, params):
            assert params == {"year": 2026, "month": 8, "day": 24, "count": 100, "skip": 0}
            return {"items": [sample]}

    class FakeClient:
        settlement = FakeSettlement()

    settlement = to_settlement(sample)
    assert settlement.amount_paise == 9973635
    assert settlement.created_at.tzinfo is UTC
    assert fetch_settlements(client=FakeClient()) == [settlement]
    assert fetch_recon_details(2026, 8, day=24, client=FakeClient())["items"] == [sample]

    print("[razorpay] ok - response mapping and request parameters verified")
