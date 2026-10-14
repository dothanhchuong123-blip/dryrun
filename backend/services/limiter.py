"""Per-model rate limiter driven by x-ratelimit-* headers, Retry-After, tier priority.

See SPEC §3.2. Implemented in task T04 (prompts/1_oct15_all-parallel/T04-llm-router.md).
"""
