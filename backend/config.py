"""Single source of runtime config. Read model IDs, URLs and keys ONLY through `get_settings()`."""
from datetime import date
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
    "vision": (0.30, 0.90),  # placeholder = Super's price until the Day-0 check records the real one (SPEC §3.3)
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
    model_vision: str = "nvidia/Nemotron-3.5-Super-VL"  # F5: reads photos of reports and price lists
    daily_spend_cap_usd: float = 1.00
    public_live_daily_cap_usd: float = 0.20
    # Public demo kill switch: LIVE_ENABLED=false in the host's env turns every paid Nemotron call off (replays still work).
    live_enabled: bool = True
    max_live_analyses: int = 1  # LIVE runs at once; the spend guard only sees a run's cost after it is spent
    # Judging calendar (UTC dates, SPEC §1): a bigger daily cap while judges test, LIVE off after the last day.
    judging_start: date = date(2026, 12, 1)
    judging_end: date = date(2026, 12, 16)  # last day LIVE is on
    judging_live_daily_cap_usd: float = 0.70
    tavily_daily_credit_cap: int = 30  # public "Check live news" button, SPEC §6
    # Serverless Job "mc-10k" (T09, docs/DEPLOY.md). job_backend: "" = not deployed, "local" = subprocess, "nebius" = CLI.
    job_backend: str = ""
    job_data_dir: str = "/data"  # the Object Storage bucket, mounted here (endpoint and job see the same files)
    job_bucket: str = ""
    job_image: str = ""
    job_platform: str = "cpu-d3"
    job_preset: str = "4vcpu-16gb"
    job_n_paths: int = 10000
    job_timeout: str = "1h"
    job_poll_s: float = 5.0
    job_max_wait_s: float = 1800.0
    nebius_cli: str = "nebius"
    frontend_origin: str = ""  # CORS allow-origin for the Next.js site; "" = same origin only

    def live_cap_on(self, day: date) -> float:
        """The public LIVE budget for `day` in USD; 0 means LIVE is off (switched off, or judging is over)."""
        if not self.live_enabled or day > self.judging_end:
            return 0.0
        if day >= self.judging_start:
            return self.judging_live_daily_cap_usd
        return self.public_live_daily_cap_usd


@lru_cache
def get_settings() -> Settings:
    return Settings()
