"""3x3 payoff matrix, pure/mixed Nash equilibria, Nash/price-war/collusion labels.

See SPEC §4.4. Implemented in task T02 (prompts/1_oct15_all-parallel/T02-engine-inventory-game.md).
"""
from __future__ import annotations

import warnings
from collections.abc import Callable, Sequence
from typing import Literal

import nashpy as nash
import numpy as np

GameLabel = Literal["nash", "price_war", "collusion", "other"]


def payoff_matrix(
    price: np.ndarray | Sequence[float],
    profit_fn: Callable[[float, float], tuple[float, float] | np.ndarray],
    deltas: Sequence[float] = (-0.10, 0.0, 0.10),
) -> tuple[np.ndarray, np.ndarray]:
    """Build 3x3 normal-form payoff matrices (pa, pb) around current prices.

    Rows index firm A's action (0=cut, 1=hold, 2=raise); columns index firm B's action.
    """
    base_p = np.asarray(price, dtype=float)
    n = len(deltas)
    pa = np.zeros((n, n), dtype=float)
    pb = np.zeros((n, n), dtype=float)

    for i, da in enumerate(deltas):
        p_a = float(base_p[0]) * (1.0 + float(da))
        for j, db in enumerate(deltas):
            p_b = float(base_p[1]) * (1.0 + float(db))
            pi_a, pi_b = profit_fn(p_a, p_b)
            pa[i, j] = float(pi_a)
            pb[i, j] = float(pi_b)

    return pa, pb


def nash_equilibria(
    pa: np.ndarray,
    pb: np.ndarray,
) -> tuple[list[tuple[int, int]], dict[str, list[float]] | None]:
    """Find pure Nash equilibria by best-response check; fallback to first mixed NE via nashpy."""
    pa_arr = np.asarray(pa, dtype=float)
    pb_arr = np.asarray(pb, dtype=float)
    n_rows, n_cols = pa_arr.shape

    col_max = np.max(pa_arr, axis=0)
    row_max = np.max(pb_arr, axis=1)

    pure: list[tuple[int, int]] = []
    for i in range(n_rows):
        for j in range(n_cols):
            a_br = np.isclose(pa_arr[i, j], col_max[j], rtol=1e-9, atol=1e-12)
            b_br = np.isclose(pb_arr[i, j], row_max[i], rtol=1e-9, atol=1e-12)
            if a_br and b_br:
                pure.append((int(i), int(j)))

    if pure:
        return pure, None

    game = nash.Game(pa_arr, pb_arr)
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        eq_iter = game.support_enumeration()
        first_eq = next(iter(eq_iter), None)
        if first_eq is None:
            first_eq = next(iter(game.vertex_enumeration()), None)

    if first_eq is None:
        return [], None

    sigma_a, sigma_b = first_eq
    mixed = {
        "p_A": [float(x) for x in sigma_a],
        "p_B": [float(x) for x in sigma_b],
    }
    return [], mixed


def classify(
    chosen: tuple[int, int] | Sequence[int],
    pa: np.ndarray,
    pb: np.ndarray,
    pure: Sequence[tuple[int, int]],
) -> GameLabel:
    """Classify the realised action pair (SPEC §4.4).

    - "price_war": both firms Cut (0, 0) and joint profit < joint profit at (Hold, Hold) (1, 1).
    - "nash": realised cell is in `pure`.
    - "collusion": realised cell is not a NE and its joint profit >= the NE's joint profit.
    - "other": any other outcome.
    """
    pa_arr = np.asarray(pa, dtype=float)
    pb_arr = np.asarray(pb, dtype=float)
    r, c = int(chosen[0]), int(chosen[1])
    cell = (r, c)
    pure_set = {(int(i), int(j)) for i, j in pure}

    joint_chosen = float(pa_arr[r, c] + pb_arr[r, c])
    if cell == (0, 0) and pa_arr.shape[0] > 1 and pa_arr.shape[1] > 1:
        joint_hold = float(pa_arr[1, 1] + pb_arr[1, 1])
        if joint_chosen < joint_hold:
            return "price_war"

    if cell in pure_set:
        return "nash"

    if pure_set:
        ne_joint = max(float(pa_arr[i, j] + pb_arr[i, j]) for i, j in pure_set)
        if joint_chosen >= ne_joint - 1e-12:
            return "collusion"

    return "other"


def action_index(prev_price: float, new_price: float, band: float = 0.03) -> int:
    """Map price movement to action index: 0 = cut, 1 = hold (within +-band), 2 = raise."""
    prev_p = float(prev_price)
    new_p = float(new_price)
    if prev_p <= 0.0:
        if new_p < prev_p:
            return 0
        if new_p > prev_p:
            return 2
        return 1

    rel_change = (new_p - prev_p) / prev_p
    if rel_change < -float(band) - 1e-12:
        return 0
    if rel_change > float(band) + 1e-12:
        return 2
    return 1


def best_response(pa: np.ndarray, rival_action: int) -> int:
    """Return focal firm's best-response action index (row) to `rival_action` (column)."""
    pa_arr = np.asarray(pa, dtype=float)
    return int(np.argmax(pa_arr[:, int(rival_action)]))

