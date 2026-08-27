import os
from pathlib import Path

from dotenv import load_dotenv
from agno.models.openai import OpenAIChat

load_dotenv()

BASE_DIR = Path(__file__).parent
DATA_DIR = BASE_DIR / "data"

BATCH_FILE = DATA_DIR / "synthetic_batch.json"
GROUND_TRUTH_FILE = DATA_DIR / "ground_truth.json"

MODEL_ID = "deepseek-ai/deepseek-v4-flash-0731"

model = OpenAIChat(
    id=MODEL_ID,
    base_url="https://integrate.api.nvidia.com/v1",
    api_key=os.getenv("NVIDIA_API_KEY"),
    temperature=0,
    top_p=0.95,
    max_tokens=16384,
    extra_body={"chat_template_kwargs": {"thinking": True, "reasoning_effort": "high"}},
    supports_native_structured_outputs=False,
)
