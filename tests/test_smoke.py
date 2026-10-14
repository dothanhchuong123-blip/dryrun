import numpy as np
from fastapi.testclient import TestClient

from backend.config import get_settings
from backend.engine.types import FirmDecision, MarketParams
from backend.main import app


def test_health():
    assert TestClient(app).get("/health").json() == {"status": "ok"}


def test_settings_never_expose_keys():
    s = get_settings()
    assert "SecretStr" in repr(s.nebius_api_key) or s.nebius_api_key.get_secret_value() == ""
    assert s.model_ultra and s.nebius_base_url.startswith("https://")


def test_types_construct():
    p = MarketParams()
    d = FirmDecision(price=np.array([100.0, 100.0]), production_plan=np.array([200.0, 200.0]),
                     marketing=np.array([0.0, 0.0]))
    assert p.n_consumers == 500 and d.price.shape == (2,)
