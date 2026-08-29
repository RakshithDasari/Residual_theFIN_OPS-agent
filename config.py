import os
from pathlib import Path

from agno.models.openai import OpenAIChat
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"

BATCH_FILE = DATA_DIR / "synthetic_batch.json"
GROUND_TRUTH_FILE = DATA_DIR / "ground_truth.json"

MODEL_ID = "moonshotai/kimi-k3"

model = OpenAIChat(
    id=MODEL_ID,
    base_url="https://openrouter.ai/api/v1",
    api_key=os.getenv("OPENROUTER_API_KEY") or os.getenv("KIOSAPI_API_KEY") or os.getenv("OPENAI_API_KEY"),
    temperature=0,
    top_p=0.95,
    max_tokens=2000,
    seed=42,
    supports_native_structured_outputs=False,
)
