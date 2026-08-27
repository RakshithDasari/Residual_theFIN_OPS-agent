import os
from pathlib import Path

from agno.models.anthropic import Claude
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"

BATCH_FILE = DATA_DIR / "synthetic_batch.json"
GROUND_TRUTH_FILE = DATA_DIR / "ground_truth.json"

MODEL_ID = "claude-sonnet-5"

model = Claude(
    id=MODEL_ID,
    api_key=os.getenv("ANTHROPIC_API_KEY"),
    temperature=0,
)
