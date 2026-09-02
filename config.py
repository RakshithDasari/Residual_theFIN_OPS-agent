import os
from pathlib import Path

from agno.models.openai import OpenAIChat
from dotenv import load_dotenv

load_dotenv()

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"

BATCH_FILE = DATA_DIR / "synthetic_batch.json"
GROUND_TRUTH_FILE = DATA_DIR / "ground_truth.json"

API_KEY = os.getenv("HF_TOKEN")
BASE_URL = os.getenv("HF_BASE_URL", "https://router.huggingface.co/v1")
MODEL_ID = os.getenv("HF_MODEL_ID", "zai-org/GLM-5.3-Flash:novita")

model = OpenAIChat(
    id=MODEL_ID,
    base_url=BASE_URL,
    api_key=API_KEY,
    temperature=0,
    top_p=0.95,
    max_tokens=2000,
    supports_native_structured_outputs=False,
    role_map={
        "system": "system",
        "user": "user",
        "assistant": "assistant",
        "tool": "tool",
        "model": "assistant",
    },
    retries=3,
    delay_between_retries=4,
    exponential_backoff=True,
)
