from contextvars import ContextVar
from dataclasses import dataclass, field
from datetime import datetime

from data.schemas import ExpectedRecord, SettlementRecord

# ── Record Context ────────────────────────────────────────────────────────────
# Set this before every agent run. Every tool reads from here — no record, no
# settlement list and no dates in tool signatures, so the model cannot retype an
# amount or a UTR into an argument it could get wrong.
# Records fan out concurrently; each asyncio task gets its own copy of the context,
# so a set() inside one run is invisible to the others.


@dataclass
class RecordContext:
    expected: ExpectedRecord
    settlements: list[SettlementRecord]
    as_of: datetime
    matched: SettlementRecord | None = field(default=None)


current_record: ContextVar[RecordContext | None] = ContextVar("current_record", default=None)


def set_current_record(expected, settlements, as_of) -> RecordContext:
    """Call before running the agent. Returns the context so the caller can read back
    which settlement the run paired."""
    context = RecordContext(expected=expected, settlements=settlements, as_of=as_of)
    current_record.set(context)
    return context


def get_current_record() -> RecordContext:
    """Call inside any tool to get the record under reconciliation."""
    context = current_record.get()
    if context is None:
        raise RuntimeError("No record is bound. Call set_current_record() before running the agent.")
    return context


if __name__ == "__main__":
    import asyncio
    import json

    from config import BATCH_FILE

    batch = json.loads(BATCH_FILE.read_text())
    expected_records = [ExpectedRecord(**r) for r in batch["expected_records"]]
    settlements = [SettlementRecord(**s) for s in batch["settlements"]]
    as_of = datetime(2026, 8, 24)

    try:
        get_current_record()
        raise AssertionError("an unbound tool call must not be allowed to look like a clean one")
    except RuntimeError:
        pass

    # The whole design rests on this: 55 runs share one agent and one set of tool
    # functions, and each still sees only its own record.
    async def bind_and_read(expected):
        context = set_current_record(expected, settlements, as_of)
        await asyncio.sleep(0)
        context.matched = settlements[0]
        return get_current_record()

    async def fan_out():
        return await asyncio.gather(*(bind_and_read(r) for r in expected_records))

    seen = asyncio.run(fan_out())
    assert [c.expected.record_id for c in seen] == [r.record_id for r in expected_records]
    assert all(c.matched is settlements[0] for c in seen)
    assert current_record.get() is None, "the fan-out leaked a record back into the caller"

    print(f"[context] ok - {len(seen)} concurrent runs, no record crossed over")
