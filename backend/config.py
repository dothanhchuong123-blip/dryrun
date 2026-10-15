"""Single source of runtime config. Read model IDs, URLs and keys ONLY through `get_settings()`."""
from functools import lru_cache
from pathlib import Path

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict

ROOT = Path(__file__).resolve().parent.parent

# USD per 1M tokens (input, output) — Nebius Nemotron pricing page, verified 2026-10-14 (SPEC §3.3)
PRICES_PER_M = {
    "ultra": (1.00, 3.00),
    "super": (0.30, 0.90),
    "fast": (0.06, 0.24),
    "fast_fallback": (0.06, 0.24),
}


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ROOT / ".env", extra="ignore")

    nebius_api_key: SecretStr = SecretStr("")
    tavily_api_key: SecretStr = SecretStr("")
    nebius_base_url: str = "https://api.tokenfactory.nebius.com/v1/"
    # Verified IDs (case-sensitive), SPEC §3.3. Override via .env.
    model_ultra: str = "nvidia/Nemotron-3-Ultra-550b-a55b"
    model_super: str = "nvidia/nemotron-3-super-120b-a12b"
    model_fast: str = "nvidia/Nemotron-3_5-Lightning"
    model_fast_fallback: str = "nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B"
    daily_spend_cap_usd: float = 1.00
    public_live_daily_cap_usd: float = 0.20
    tavily_daily_credit_cap: int = 30  # public "Check live news" button, SPEC §6
    frontend_origin: str = ""  # CORS allow-origin for the Next.js site; "" = same origin only


@lru_cache
def get_settings() -> Settings:
    return Settings()
