"""The reconciled batch as a CSV a finance team can open.

Built server-side with the stdlib csv writer rather than joined together in the browser,
so quoting is correct when an explanation contains a comma — which most of them do — and
so the export cannot drift from the columns the API actually returns.

Run from the project root:  python -m reporting.csv_export
"""

import csv
import io

from agent import taxonomy
from data.schemas import ReconciledRecord

COLUMNS = (
    "record_id",
    "business_type",
    "status",
    "primary_cause",
    "primary_cause_label",
    "contributing_causes",
    "expected_amount_rupees",
    "actual_amount_rupees",
    "difference_rupees",
    "settlement_id",
    "confidence",
    "explanation",
    "tool_calls",
    "reasoning_path",
)


def _rupees(paise) -> str:
    """Plain decimal for a spreadsheet: no separators, no currency symbol, so it sums."""
    return "" if paise is None else f"{paise / 100:.2f}"


def _row(record: ReconciledRecord) -> dict:
    actual = record.actual_amount_paise
    difference = None if actual is None else record.expected_amount_paise - actual
    return {
        "record_id": record.record_id,
        "business_type": record.business_type.value,
        "status": record.status.value,
        "primary_cause": record.primary_cause.value,
        "primary_cause_label": taxonomy.CAUSES[record.primary_cause].label,
        "contributing_causes": "; ".join(cause.value for cause in record.contributing_causes),
        "expected_amount_rupees": _rupees(record.expected_amount_paise),
        "actual_amount_rupees": _rupees(actual),
        "difference_rupees": _rupees(difference),
        "settlement_id": record.settlement_id or "",
        "confidence": f"{record.confidence:.2f}",
        "explanation": record.explanation,
        "tool_calls": len(record.trace),
        "reasoning_path": " > ".join(f"{step.step}:{step.result}" for step in record.trace),
    }


def to_csv(records: list[ReconciledRecord]) -> str:
    """The whole batch as CSV text, header first."""
    buffer = io.StringIO()
    # Excel needs CRLF to not double-space rows when the file is opened directly.
    writer = csv.DictWriter(buffer, fieldnames=COLUMNS, lineterminator="\r\n")
    writer.writeheader()
    for record in records:
        writer.writerow(_row(record))
    return buffer.getvalue()


if __name__ == "__main__":
    import json
    from datetime import datetime

    from config import BATCH_FILE
    from data.schemas import ExpectedRecord, SettlementRecord
    from engine import reconciler

    batch = json.loads(BATCH_FILE.read_text())
    expected_records = [ExpectedRecord(**r) for r in batch["expected_records"]]
    settlements = [SettlementRecord(**s) for s in batch["settlements"]]
    records = reconciler.reconcile_batch(expected_records, settlements, datetime(2026, 8, 24))

    text = to_csv(records)
    rows = list(csv.DictReader(io.StringIO(text)))

    assert len(rows) == len(records), f"{len(rows)} rows for {len(records)} records"
    assert list(rows[0]) == list(COLUMNS), rows[0].keys()

    # Explanations contain commas, so a broken writer would split one row into several.
    assert any("," in record.explanation for record in records), "test batch cannot prove quoting"
    for row, record in zip(rows, records):
        assert row["explanation"] == record.explanation, f"{record.record_id} lost its prose"
        assert row["record_id"] == record.record_id

    # The money must survive the round trip as a number a spreadsheet can add up.
    paired = [(row, rec) for row, rec in zip(rows, records) if rec.actual_amount_paise is not None]
    for row, record in paired:
        assert round(float(row["actual_amount_rupees"]) * 100) == record.actual_amount_paise
        assert round(float(row["difference_rupees"]) * 100) == (
            record.expected_amount_paise - record.actual_amount_paise
        )

    unpaired = [row for row, rec in zip(rows, records) if rec.actual_amount_paise is None]
    assert all(row["actual_amount_rupees"] == "" for row in unpaired), "no settlement must be blank, not 0"

    print(f"[csv_export] ok - {len(rows)} rows, {len(COLUMNS)} columns, quoting verified")
