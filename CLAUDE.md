# House style

Derived from Ardy's own Agno projects (`internship/f1`, `f2/finance_persona`, `f3`).
Match these. When in doubt, go and read those files.

## Agno

- Target **agno 2.9.0** (installed). Never `agno.playground` — it does not exist in 2.9.0.
  The Playground is `from agno.os import AgentOS`.
- Current 2.x names: `output_schema`, `RunOutput`, `RunInput`, `tool_call_limit`,
  `pre_hooks`, `post_hooks`, `db=`.
- Guardrails subclass `BaseGuardrail` and raise `InputCheckError` / `OutputCheckError`
  with a `check_trigger`. Post-hooks are plain functions taking `run_output`.
- `SqliteDb` needs `sqlalchemy`, which is not installed. Add the dep or skip the db.

## Layout

- `config.py` at the root: `load_dotenv()`, paths, and the shared `model` singleton.
  Nothing else constructs a model.
- `context.py` at the root: `ContextVar` for whatever every tool needs but no tool should
  take as an argument. Set it at the entry point.
- `agent/` holds agent objects. `agent/tools.py` holds tool functions.
- `playground.py` at the root, wiring `AgentOS`.

## Agents

- Module-level singleton, not a factory: `reconciliation_agent = Agent(...)`.
- Always `name=` and `role=`. `instructions=` is a list of short strings, one idea each.
- Sequencing guidance goes in `instructions`, naming the tools — not in tool docstrings.

## Tools

- Plain module-level functions. Not classes, not bound methods, not closures.
- Typed signature, `-> str` return, **one-line** docstring. The docstring says what the
  tool does, nothing about when to call it.
- Anything shared across tools comes from `context.py`, never from a parameter.

## Comments

- Agent and tool files: none. The code and the docstrings are the documentation.
- Infrastructure files: a short docstring per function, `# ── Section ───` dividers when
  a file has real sections.
- A comment earns its place only by explaining something the code cannot. Delete any
  comment that restates the line under it.
- Design reasoning belongs in `NOTES.md`, not in the source.

## Prints and checks

- Status prints are prefixed: `print(f"[schema] ...")`.
- Every module keeps its `__main__` self-check. It is the only test layer — no pytest, no
  fixtures. Asserts, then one `... ok` summary line.

## Non-negotiable for this project

- Never claim integration with Razorpay's Agent Studio products. Only the documented
  Settlements and Settlement Recon APIs.
- `ground_truth.json` never reaches the matcher, the tools, or the prompt.
- Money is integer paise everywhere. The only float is a rupee display string.
- Accuracy numbers come from `evaluation/eval.py` as computed. Never cherry-picked.
