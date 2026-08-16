"""Keep unit tests hermetic even when the local Agent has a live model key."""

import os


os.environ.setdefault("AGENT_LLM_ENABLED", "0")
