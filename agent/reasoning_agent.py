import asyncio
import json
import re
from textwrap import dedent

from agno.agent import Agent
from pydantic import BaseModel, Field

from agent import taxonomy
from agent.tools import (
    MATCH_TOOLS,
    MATCHED_PREFIX,
    check_arithmetic_causes,
    days_awaiting_settlement,
    try_exact_match,
    try_fuzzy_match,
)
from config import model
from context import set_current_record
from data.schemas import DiscrepancyCause, ReconciledRecord, TraceStep

# The longest honest path is three calls: exact, fuzzy, then arithmetic or the date check.
MAX_TOOL_CALLS = 6
CONCURRENCY = 8


class Diagnosis(BaseModel):
    primary_cause: DiscrepancyCause
    contributing_causes: list[DiscrepancyCause] = Field(default_factory=list)
    explanation: str = Field(..., description="Two or three sentences for a merchant's finance team")
    confidence: float = Field(..., ge=0.0, le=1.0)


reconciliation_agent = Agent(
    name="Settlement Reconciliation Agent",
    role="Work out whether a settlement matches what the merchant expected, and if not, why",
    model=model,
    tools=[try_exact_match, try_fuzzy_match, check_arithmetic_causes, days_awaiting_settlement],
    description=dedent("""\
        You are a settlement reconciliation analyst working one merchant record at a time.

        The expected side comes from the merchant's own order system. The actual side comes
        from Razorpay. The two carry different identifiers and different amounts, because
        fees and taxes come out in between. Closing that gap is the job.
    """),
    instructions=[
        "Choose which tools to call and in what order. There is no fixed sequence. Stop as "
        "soon as you have enough evidence to name a cause.",

        "try_exact_match() pairs a record whose reference is the bank UTR verbatim, which most "
        "records are. try_fuzzy_match() pairs a reference that is a truncated or mistyped copy "
        "of a UTR, and tells you the basis for the match it made.",

        "check_arithmetic_causes() only means anything once a settlement is paired, and it gives "
        "you evidence rather than a verdict — the conclusion is yours to draw. "
        "days_awaiting_settlement() is how you separate a record still inside the settlement "
        "window from one that is being held.",

        "Never do arithmetic yourself. Every figure you quote must come from a tool result. If "
        "you need a number you do not have, call the tool that produces it.",

        "Amounts are in paise. If neither match finds a settlement, that absence is itself the "
        "finding.",

        "Diagnose against this taxonomy and answer with one of these exact cause values:\n\n"
        + taxonomy.as_prompt_block(),

        "Put the deductions that also applied, but were not the main story, in "
        "contributing_causes. An ordinary settlement has the processing fee and its GST there.",

        dedent("""\
            Calibrate confidence honestly:
            - 0.90 and above: the residual matches a reference amount exactly, or reconciles to zero.
            - 0.60 to 0.89: consistent with the cause, but nothing confirms it arithmetically.
            - below 0.60: you are guessing. Answer unresolved instead and state the residual."""),

        "Write the explanation for a merchant's finance team, not an engineer. Two or three "
        "sentences, give the amount in rupees, and say what they should do about it, including "
        "that they need do nothing when nothing is wrong.",

        "After using the tools, return exactly one JSON object with the fields primary_cause, "
        "contributing_causes, explanation, and confidence. Do not wrap it in markdown.",

        "Prefer unresolved to a cause that nearly fits. A confident wrong explanation costs the "
        "merchant more than an honest gap does.",
    ],
    tool_call_limit=MAX_TOOL_CALLS,
    telemetry=False,
)


def build_prompt(expected) -> str:
    """Serialise through the model so linked_settlement_id is excluded structurally, not
    because this function happened to leave it out."""
    fields = expected.model_dump(mode="json")
    lines = "\n".join(f"{key}: {value}" for key, value in fields.items())
    return f"Reconcile this record.\n\n{lines}"


def build_trace(run) -> list[TraceStep]:
    """Turn the tool calls Agno logged into the reasoning path the drilldown shows."""
    steps = []
    for call in run.tools or []:
        output = call.result or ""
        if call.tool_call_error:
            outcome = "error"
        elif MATCHED_PREFIX in output:
            outcome = "found"
        elif call.tool_name in MATCH_TOOLS:
            outcome = "not found"
        else:
            outcome = "ok"
        steps.append(TraceStep(step=call.tool_name, result=outcome, detail=" ".join(output.split())))
    return steps


def parse_diagnosis(content) -> Diagnosis | None:
    """Parse and validate the model's final diagnosis without provider schema enforcement."""
    if isinstance(content, Diagnosis):
        return content
    if not isinstance(content, str):
        return None

    candidates = [content.strip()]
    candidates.extend(re.findall(r"```(?:json)?\s*(\{.*?\})\s*```", content, re.DOTALL))
    start = content.find("{")
    end = content.rfind("}")
    if start >= 0 and end > start:
        candidates.append(content[start : end + 1])

    for candidate in candidates:
        try:
            return Diagnosis.model_validate(json.loads(candidate))
        except (json.JSONDecodeError, TypeError, ValueError):
            continue
    return None


def _unreadable(expected, trace) -> ReconciledRecord:
    """Return an unresolved record when the model's final diagnosis cannot be validated."""
    return ReconciledRecord(
        record_id=expected.record_id,
        business_type=expected.business_type,
        expected_amount_paise=expected.expected_amount_paise,
        primary_cause=DiscrepancyCause.UNRESOLVED,
        explanation="The agent did not return a diagnosis we could read for this record.",
        confidence=0.0,
        trace=trace,
    )


async def reconcile_record(expected, settlements, as_of) -> ReconciledRecord:
    record = set_current_record(expected, settlements, as_of)
    run = await reconciliation_agent.arun(build_prompt(expected))
    trace = build_trace(run)

    diagnosis = parse_diagnosis(run.content)
    if diagnosis is None:
        return _unreadable(expected, trace)

    settlement = record.matched
    return ReconciledRecord(
        record_id=expected.record_id,
        business_type=expected.business_type,
        expected_amount_paise=expected.expected_amount_paise,
        actual_amount_paise=settlement.amount_paise if settlement else None,
        settlement_id=settlement.settlement_id if settlement else None,
        primary_cause=diagnosis.primary_cause,
        contributing_causes=diagnosis.contributing_causes,
        explanation=diagnosis.explanation,
        confidence=diagnosis.confidence,
        trace=trace,
    )


async def reconcile_batch(expected_records, settlements, as_of, concurrency=CONCURRENCY):
    limit = asyncio.Semaphore(concurrency)

    async def one(expected):
        async with limit:
            return await reconcile_record(expected, settlements, as_of)

    return await asyncio.gather(*(one(record) for record in expected_records))


if __name__ == "__main__":
    import json
    from datetime import datetime
    from types import SimpleNamespace

    from agno.models.response import ToolExecution

    from config import BATCH_FILE, MODEL_ID
    from data.schemas import ExpectedRecord, RecordStatus, SettlementRecord

    batch = json.loads(BATCH_FILE.read_text())
    expected_records = [ExpectedRecord(**r) for r in batch["expected_records"]]
    settlements = [SettlementRecord(**s) for s in batch["settlements"]]

    system_message = reconciliation_agent.get_system_message(run_context=None, session=None).content
    assert all(cause.value in system_message for cause in DiscrepancyCause), "a cause never reaches the model"
    assert len(reconciliation_agent.tools) == 4
    assert reconciliation_agent.tool_call_limit == MAX_TOOL_CALLS
    assert reconciliation_agent.model.temperature == 0
    assert reconciliation_agent.model.top_p == 0.95
    assert reconciliation_agent.model.supports_native_structured_outputs is False

    # exclude=True stops the answer key being serialised; it does not stop attribute
    # access. This is the check that the prompt is built the safe way.
    for expected in expected_records:
        prompt = build_prompt(expected)
        assert "linked_settlement_id" not in prompt
        if expected.linked_settlement_id:
            assert expected.linked_settlement_id not in prompt, f"{expected.record_id} leaked its pairing"
        assert expected.reference_hint in prompt and str(expected.expected_amount_paise) in prompt

    fake_run = SimpleNamespace(
        tools=[
            ToolExecution(tool_name="try_exact_match", result="No settlement has a UTR equal to this reference (UTR123)."),
            ToolExecution(tool_name="try_fuzzy_match", result=f"{MATCHED_PREFIX} setl_ABC: reference is the\nfirst 13 characters."),
            ToolExecution(tool_name="check_arithmetic_causes", result="residual_paise: 0"),
            ToolExecution(tool_name="try_exact_match", result=None, tool_call_error=True),
        ]
    )
    assert [s.result for s in build_trace(fake_run)] == ["not found", "found", "ok", "error"]
    assert "\n" not in build_trace(fake_run)[1].detail, "trace details must stay one line for the UI"
    assert build_trace(SimpleNamespace(tools=None)) == []

    diagnosis = Diagnosis.model_validate_json(
        '{"primary_cause": "tds", "contributing_causes": ["mdr_fee", "gst_on_fee"],'
        ' "explanation": "Rs 83.60 was withheld as TDS.", "confidence": 0.95}'
    )
    assert diagnosis.primary_cause is DiscrepancyCause.TDS

    assert parse_diagnosis(diagnosis.model_dump_json()).primary_cause is DiscrepancyCause.TDS
    fenced = "```json\n" + diagnosis.model_dump_json() + "\n```"
    assert parse_diagnosis(fenced).primary_cause is DiscrepancyCause.TDS
    assert parse_diagnosis("not a diagnosis") is None

    unreadable = _unreadable(expected_records[0], [])
    assert unreadable.status is RecordStatus.UNRESOLVED and unreadable.confidence == 0.0

    print(f"[agent] ok - {MODEL_ID}, 4 tools, limit {MAX_TOOL_CALLS}, {len(expected_records)} prompts with no pairing leak")
