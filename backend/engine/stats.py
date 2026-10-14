"""CI95, paired t-test + Cohen's d, chi-square switching test.

See SPEC §4.6. Implemented in task T03 (prompts/2_oct16-17_all-parallel/T03-stats-montecarlo.md).
"""
from __future__ import annotations

from collections.abc import Sequence
from typing import Any

import numpy as np
from scipy import stats


def ci95(x: Sequence[float] | np.ndarray) -> tuple[float, float, float]:
    """Compute (mean, lo, hi) 95% confidence interval using the Student's t-distribution."""
    arr = np.asarray(x, dtype=np.float64).ravel()
    n = int(arr.size)
    if n == 0:
        return 0.0, 0.0, 0.0

    mean = float(np.mean(arr))
    if n < 2:
        return mean, mean, mean

    sd = float(np.std(arr, ddof=1))
    if sd <= 0.0 or not np.isfinite(sd):
        return mean, mean, mean

    se = sd / float(np.sqrt(n))
    t_crit = float(stats.t.ppf(0.975, df=n - 1))
    half = t_crit * se
    return mean, mean - half, mean + half


def paired_alpha_test(
    pi_ai: Sequence[float] | np.ndarray,
    pi_base: Sequence[float] | np.ndarray,
) -> dict[str, Any]:
    """Run one-sided paired t-test (H1: pi_ai > pi_base) over common-random-number paths.

    Returns dict(n, delta_mean, ci95, cohens_d, t, p_value, d_pooled, no_variation).
    cohens_d is d_z = mean(delta) / s_delta; d_pooled = mean(delta) / sqrt((s_ai^2 + s_base^2) / 2),
    because CRN shrinks s_delta (SPEC §4.6). If s_delta == 0 the t-test is skipped,
    no_variation is True and t / cohens_d / p_value are None (JSON-safe, no inf).
    """
    ai = np.asarray(pi_ai, dtype=np.float64).ravel()
    base = np.asarray(pi_base, dtype=np.float64).ravel()
    if ai.shape != base.shape:
        raise ValueError(f"pi_ai and pi_base must have matching shapes, got {ai.shape} vs {base.shape}")

    n = int(ai.size)
    if n == 0:
        return {
            "n": 0,
            "delta_mean": 0.0,
            "ci95": (0.0, 0.0),
            "cohens_d": 0.0,
            "t": 0.0,
            "p_value": 1.0,
            "d_pooled": 0.0,
            "no_variation": True,
        }

    delta = ai - base
    delta_mean, lo, hi = ci95(delta)
    if n < 2:
        return {
            "n": n,
            "delta_mean": delta_mean,
            "ci95": (lo, hi),
            "cohens_d": 0.0,
            "t": 0.0,
            "p_value": 1.0,
            "d_pooled": 0.0,
            "no_variation": True,
        }

    s_pooled = float(np.sqrt((np.var(ai, ddof=1) + np.var(base, ddof=1)) / 2.0))
    d_pooled = float(delta_mean / s_pooled) if s_pooled > 1e-15 else 0.0

    s_delta = float(np.std(delta, ddof=1))
    if s_delta <= 1e-15:
        zero = abs(delta_mean) <= 1e-15
        return {
            "n": n,
            "delta_mean": delta_mean,
            "ci95": (lo, hi),
            "cohens_d": 0.0 if zero else None,
            "t": 0.0 if zero else None,
            "p_value": 1.0 if zero else None,
            "d_pooled": d_pooled,
            "no_variation": True,
        }

    res = stats.ttest_rel(ai, base, alternative="greater")
    t_stat = float(res.statistic)
    p_val = float(res.pvalue)
    cohens_d = float(delta_mean / s_delta)
    return {
        "n": n,
        "delta_mean": delta_mean,
        "ci95": (lo, hi),
        "cohens_d": cohens_d,
        "t": t_stat,
        "p_value": p_val,
        "d_pooled": d_pooled,
        "no_variation": False,
    }


def _window_switch_counts(choices: np.ndarray) -> tuple[int, int]:
    """Count consumers who (switched, stayed) within a (T, N) choice log; 0 = outside, 1 = A, 2 = B.

    One observation per consumer per window (SPEC §4.6): outside-good ticks are dropped, a consumer
    switched if any two consecutive inside purchases differ, and consumers with < 2 inside purchases
    in the window are excluded.
    """
    arr = np.asarray(choices)
    if arr.ndim != 2:
        raise ValueError(f"Expected 2D choices array of shape (T, N), got shape {arr.shape}")
    if arr.shape[0] < 2 or arr.shape[1] == 0:
        return 0, 0

    switched = 0
    stayed = 0
    for col in arr.T:
        inside = col[col != 0]
        if inside.size < 2:
            continue
        if np.any(inside[1:] != inside[:-1]):
            switched += 1
        else:
            stayed += 1
    return switched, stayed


def switching_chi2(
    choices_pre: np.ndarray,
    choices_post: np.ndarray,
) -> dict[str, Any]:
    """Run a 2x2 chi-square contingency test comparing brand switching pre- vs post-shock.

    A consumer switched if their brand (A/B) differs from their previous inside purchase.
    Table layout: rows = (pre, post), cols = (switched, stayed).
    """
    pre_sw, pre_st = _window_switch_counts(choices_pre)
    post_sw, post_st = _window_switch_counts(choices_post)
    table = np.array([[pre_sw, pre_st], [post_sw, post_st]], dtype=np.int64)

    if np.any(table.sum(axis=0) == 0) or np.any(table.sum(axis=1) == 0):
        return {
            "chi2": 0.0,
            "p": 1.0,
            "table": table,
        }

    chi2, p, _dof, _expected = stats.chi2_contingency(table)
    return {
        "chi2": float(chi2),
        "p": float(p),
        "table": table,
    }

