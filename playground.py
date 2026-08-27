import json
from datetime import datetime

from agno.os import AgentOS

from agent.reasoning_agent import reconciliation_agent
from config import BATCH_FILE
from context import set_current_record
from data.schemas import ExpectedRecord, SettlementRecord

BATCH_DATE = datetime(2026, 8, 24)
PLAYGROUND_RECORD = 0

batch = json.loads(BATCH_FILE.read_text())
expected_records = [ExpectedRecord(**r) for r in batch["expected_records"]]
settlements = [SettlementRecord(**s) for s in batch["settlements"]]

# Every tool reads the record under reconciliation from context, so one has to be bound
# before any chat here can work. Change PLAYGROUND_RECORD to watch a different record.
set_current_record(expected_records[PLAYGROUND_RECORD], settlements, BATCH_DATE)

agent_os = AgentOS(agents=[reconciliation_agent])
app = agent_os.get_app()


if __name__ == "__main__":
    record = expected_records[PLAYGROUND_RECORD]
    print(f"[playground] record {record.record_id}, {record.expected_amount_paise} paise expected")
    agent_os.serve("playground:app", reload=True)
