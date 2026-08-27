from collections import Counter

from data.schemas import DiscrepancyCause, ReconciledRecord, RecordStatus


def build_report(records: list[ReconciledRecord]) -> dict:
    """Build the summary and record list the API returns."""
    total = len(records)
    matched = sum(record.status is RecordStatus.MATCHED for record in records)
    explained = sum(record.status is RecordStatus.EXPLAINED for record in records)
    in_transit = sum(record.status is RecordStatus.IN_TRANSIT for record in records)
    unresolved = sum(record.status is RecordStatus.UNRESOLVED for record in records)
    paired = sum(record.settlement_id is not None for record in records)
    needs_attention = sum(
        record.primary_cause in {DiscrepancyCause.DISPUTE_HOLD, DiscrepancyCause.UNRESOLVED}
        for record in records
    )
    categories = Counter(
        record.primary_cause.value for record in records if record.status is not RecordStatus.MATCHED
    )

    return {
        "summary": {
            "total_records": total,
            "matched_records": matched,
            "explained_records": explained,
            "in_transit_records": in_transit,
            "unresolved_records": unresolved,
            "needs_attention": needs_attention,
            "match_rate": round(100 * (matched + explained) / total, 1) if total else 0.0,
            "pair_rate": round(100 * paired / total, 1) if total else 0.0,
            "exception_categories": dict(categories),
        },
        "records": [record.model_dump(mode="json") for record in records],
    }


if __name__ == "__main__":
    def record(cause, settlement_id=None):
        return ReconciledRecord(
            record_id=f"ORD-{cause.value}",
            business_type="ecommerce",
            expected_amount_paise=100_000,
            settlement_id=settlement_id,
            primary_cause=cause,
            explanation="Checked.",
            confidence=0.9,
        )

    report = build_report(
        [
            record(DiscrepancyCause.MDR_FEE, "setl_1"),
            record(DiscrepancyCause.TDS, "setl_2"),
            record(DiscrepancyCause.IN_TRANSIT),
            record(DiscrepancyCause.UNRESOLVED, "setl_3"),
        ]
    )
    summary = report["summary"]
    assert summary["match_rate"] == 50.0
    assert summary["pair_rate"] == 75.0
    assert summary["needs_attention"] == 1
    assert summary["exception_categories"] == {"tds": 1, "in_transit": 1, "unresolved": 1}
    print("[report] ok - match rate, pair rate, and attention count verified")
