"""Unit and performance tests for backend.engine.stats and backend.engine.montecarlo (Task T03)."""
from __future__ import annotations

import json
import time
from pathlib import Path

import numpy as np
import pytest
from scipy import stats as sp_stats

from backend.engine.market import make_archetypes
from backend.engine.montecarlo import Schedule, preview, run_paths
from backend.engine.montecarlo import main as mc_cli_main
from backend.engine.stats import ci95, paired_alpha_test, switching_chi2
from backend.engine.types import (
    N_ARCHETYPES,
    CrowdSentiment,
    FirmDecision,
    MarketParams,
    Shock,
)


def _build_schedule(
    n_ticks: int = 60,
    identical_universes: bool = False,
) -> Schedule:
    """Create a realistic 60-tick schedule with a mid-run shock for testing."""
    u1_decisions: list[FirmDecision] = []
    u2_decisions: list[FirmDecision] = []
    omega: list[np.ndarray] = []
    shocks: list[Shock] = []
    crowd: list[CrowdSentiment] = []

    for t in range(n_ticks):
        in_shock = 15 <= t < 40
        u1_dec = FirmDecision(
            price=np.array([92.0 if not in_shock else 104.0, 96.0], dtype=np.float64),
            production_plan=np.array([220.0, 210.0], dtype=np.float64),
            marketing=np.array([400.0, 350.0], dtype=np.float64),
        )
        if identical_universes:
            u2_dec = FirmDecision(
                price=u1_dec.price.copy(),
                production_plan=u1_dec.production_plan.copy(),
                marketing=u1_dec.marketing.copy(),
            )
        else:
            u2_dec = FirmDecision(
                price=np.array([115.0 if not in_shock else 132.0, float(u1_dec.price[1])], dtype=np.float64),
                production_plan=np.array([150.0, float(u1_dec.production_plan[1])], dtype=np.float64),
                marketing=np.array([100.0, float(u1_dec.marketing[1])], dtype=np.float64),
            )

        u1_decisions.append(u1_dec)
        u2_decisions.append(u2_dec)
        omega.append(np.array([0.4 if in_shock else 0.1, 0.2], dtype=np.float64))
        shocks.append(
            Shock(
                delta_c_raw=0.25 if in_shock else 0.0,
                delta_lead_time=2 if in_shock else 0,
                demand_shock=-0.05 if in_shock else 0.0,
            )
        )
        crowd.append(
            CrowdSentiment(
                mu=np.full((N_ARCHETYPES, 2), 0.15 if not in_shock else -0.05, dtype=np.float64),
                sigma=np.full((N_ARCHETYPES, 2), 0.1, dtype=np.float64),
            )
        )

    return Schedule(
        u1_decisions=u1_decisions,
        u2_decisions=u2_decisions,
        omega=omega,
        shocks=shocks,
        crowd=crowd,
        u2_omega=[w.copy() for w in omega] if identical_universes else [],
    )


def test_ci95_known_normal_sample() -> None:
    rng = np.random.default_rng(42)
    true_mu = 50.0
    true_sigma = 10.0
    sample = rng.normal(loc=true_mu, scale=true_sigma, size=500)

    mean, lo, hi = ci95(sample)
    expected_mean = float(np.mean(sample))
    expected_se = float(np.std(sample, ddof=1) / np.sqrt(sample.size))
    expected_half = float(sp_stats.t.ppf(0.975, df=sample.size - 1)) * expected_se

    assert mean == pytest.approx(expected_mean, rel=1e-12)
    assert lo == pytest.approx(expected_mean - expected_half, rel=1e-12)
    assert hi == pytest.approx(expected_mean + expected_half, rel=1e-12)
    assert lo < true_mu < hi


def test_paired_alpha_test_detects_plus_5_shift_at_n200() -> None:
    rng = np.random.default_rng(123)
    pi_base = rng.normal(loc=1000.0, scale=50.0, size=200)
    noise = rng.normal(loc=5.0, scale=4.0, size=200)
    pi_ai = pi_base + noise

    res = paired_alpha_test(pi_ai, pi_base)

    assert res["n"] == 200
    assert res["delta_mean"] == pytest.approx(float(np.mean(noise)), rel=1e-12)
    lo, hi = res["ci95"]
    assert lo > 4.0
    assert lo < res["delta_mean"] < hi
    assert res["cohens_d"] > 0.8
    assert res["t"] > 10.0
    assert res["p_value"] < 1e-15


def test_switching_chi2_detects_injected_switching_jump() -> None:
    rng = np.random.default_rng(99)
    n_consumers = 300
    t_pre, t_post = 12, 12

    # Pre-window: sticky choices (~3% switching rate per tick)
    choices_pre = np.ones((t_pre, n_consumers), dtype=np.int8)
    for t in range(1, t_pre):
        flip = rng.random(n_consumers) < 0.03
        choices_pre[t] = np.where(flip, 3 - choices_pre[t - 1], choices_pre[t - 1])

    # Post-window: elevated switching (~45% switching rate per tick)
    choices_post = np.ones((t_post, n_consumers), dtype=np.int8)
    for t in range(1, t_post):
        flip = rng.random(n_consumers) < 0.45
        choices_post[t] = np.where(flip, 3 - choices_post[t - 1], choices_post[t - 1])

    res = switching_chi2(choices_pre, choices_post)
    assert set(res.keys()) == {"chi2", "p", "table"}
    assert res["table"].shape == (2, 2)
    assert res["table"][1, 0] > res["table"][0, 0]
    assert res["chi2"] > 100.0
    assert res["p"] < 1e-20


def test_switching_chi2_one_obs_per_consumer_and_excludes_outside_good() -> None:
    # Consumer 0: A, outside, A -> stayed. Consumer 1: A, outside, B -> switched.
    # Consumer 2: only one inside purchase -> excluded. Consumer 3: A, B, A -> one switch observation.
    pre = np.array([[1, 1, 0, 1], [0, 0, 0, 2], [1, 2, 2, 1]], dtype=np.int8)
    post = np.array([[2, 2, 1, 2], [2, 1, 0, 2], [2, 1, 0, 2]], dtype=np.int8)
    res = switching_chi2(pre, post)
    assert res["table"].tolist() == [[2, 1], [1, 2]]


def test_paired_alpha_test_zero_variance_is_json_safe() -> None:
    base = np.linspace(0.0, 10.0, 50)
    res = paired_alpha_test(base + 3.0, base)
    assert res["no_variation"] is True
    assert res["delta_mean"] == pytest.approx(3.0)
    assert res["t"] is None and res["p_value"] is None and res["cohens_d"] is None
    json.dumps(res, allow_nan=False)


def test_schedule_default_u2_omega_is_baseline_zero_for_a() -> None:
    schedule = _build_schedule(n_ticks=5, identical_universes=False)
    assert all(w[0] == 0.0 and w[1] == 0.2 for w in schedule.u2_omega)
    roundtrip = Schedule.from_dict(json.loads(json.dumps(schedule.to_dict())))
    assert np.array_equal(roundtrip.u2_omega[0], schedule.u2_omega[0])


def test_montecarlo_deterministic_for_given_seed() -> None:
    params = MarketParams()
    arch = make_archetypes(params.n_consumers, np.random.default_rng(11))
    schedule = _build_schedule(n_ticks=25, identical_universes=False)

    res1 = run_paths(schedule, params, arch, n_paths=50, seed=77)
    res2 = run_paths(schedule, params, arch, n_paths=50, seed=77)
    res_diff = run_paths(schedule, params, arch, n_paths=50, seed=78)

    assert np.array_equal(res1["pi_ai"], res2["pi_ai"])
    assert np.array_equal(res1["pi_base"], res2["pi_base"])
    assert res1["fan"] == res2["fan"]
    assert not np.array_equal(res1["pi_ai"], res_diff["pi_ai"])


def test_crn_identical_policies_give_exact_zero_delta() -> None:
    params = MarketParams()
    arch = make_archetypes(params.n_consumers, np.random.default_rng(19))
    schedule = _build_schedule(n_ticks=30, identical_universes=True)

    res = run_paths(schedule, params, arch, n_paths=100, seed=55)
    delta = res["pi_ai"] - res["pi_base"]

    assert np.all(delta == 0.0)
    alpha = paired_alpha_test(res["pi_ai"], res["pi_base"])
    assert alpha["delta_mean"] == 0.0
    assert alpha["ci95"] == (0.0, 0.0)
    assert alpha["cohens_d"] == 0.0


def test_schedule_roundtrip_preview_and_cli(tmp_path: Path) -> None:
    params = MarketParams()
    arch = make_archetypes(params.n_consumers, np.random.default_rng(5))
    schedule = _build_schedule(n_ticks=10, identical_universes=False)

    payload = schedule.to_dict()
    reconstructed = Schedule.from_dict(payload)
    assert len(reconstructed) == 10
    assert np.allclose(reconstructed.u1_decisions[0].price, schedule.u1_decisions[0].price)

    last_dec = FirmDecision(
        price=np.array([95.0, 95.0], dtype=np.float64),
        production_plan=np.array([210.0, 210.0], dtype=np.float64),
        marketing=np.array([300.0, 300.0], dtype=np.float64),
    )
    prev_res = preview(schedule, last_dec, horizon=8, n=40, seed=13, params=params, archetypes=arch)
    assert prev_res["pi_ai"].shape == (40,)
    assert len(prev_res["fan"]["ai"]["p50"]) == 18

    in_path = tmp_path / "in.json"
    out_path = tmp_path / "out.json"
    in_path.write_text(json.dumps(payload), encoding="utf-8")

    exit_code = mc_cli_main(
        ["--schedule", str(in_path), "--n", "50", "--seed", "7", "--out", str(out_path)]
    )
    assert exit_code == 0
    out_data = json.loads(out_path.read_text(encoding="utf-8"))
    assert "paired_alpha_test" in out_data["stats"]
    assert "fan" in out_data
    assert out_data["stats"]["paired_alpha_test"]["n"] == 50


def test_montecarlo_performance_targets() -> None:
    params = MarketParams()
    arch = make_archetypes(params.n_consumers, np.random.default_rng(7))
    schedule = _build_schedule(n_ticks=60, identical_universes=False)

    # Warm-up call
    run_paths(schedule, params, arch, n_paths=10, seed=1)

    t0 = time.perf_counter()
    res_100 = run_paths(schedule, params, arch, n_paths=100, seed=7)
    elapsed_100 = time.perf_counter() - t0
    assert res_100["pi_ai"].shape == (100,)
    assert elapsed_100 < 0.150, f"n=100 x 60 ticks took {elapsed_100 * 1000:.1f} ms (limit 150 ms)"

    t1 = time.perf_counter()
    res_10k = run_paths(schedule, params, arch, n_paths=10_000, seed=7)
    elapsed_10k = time.perf_counter() - t1
    assert res_10k["pi_ai"].shape == (10_000,)
    assert elapsed_10k < 30.0, f"n=10,000 x 60 ticks took {elapsed_10k:.2f} s (limit 30 s)"

