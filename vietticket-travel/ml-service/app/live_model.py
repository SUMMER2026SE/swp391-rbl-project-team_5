"""Small, explainable operational models for LiveTrip.

The service intentionally trains only from timestamped observations supplied by
the Node API. It never invents a production claim: below the minimum history
the response is a labelled, deterministic fallback with conservative intervals.
"""

from __future__ import annotations

from datetime import datetime, timezone
from math import ceil
from typing import Any
from zoneinfo import ZoneInfo

import numpy as np
from sklearn.ensemble import GradientBoostingRegressor
from sklearn.metrics import mean_absolute_error


FEATURE_NAMES = [
    "capacity",
    "booked_guests",
    "held_guests",
    "queue_guests",
    "checkins_last_15m",
    "pressure_score",
    "show_rate",
    "minute_of_day",
    "day_of_week",
]
MIN_TRAINING_ROWS = 24
VIETNAM_TIMEZONE = ZoneInfo("Asia/Ho_Chi_Minh")


def _features(row: Any) -> list[float]:
    timestamp = row.timestamp
    if timestamp.tzinfo is None:
        timestamp = timestamp.replace(tzinfo=timezone.utc)
    local_timestamp = timestamp.astimezone(VIETNAM_TIMEZONE)
    return [
        float(row.capacity),
        float(row.booked_guests),
        float(row.held_guests),
        float(row.queue_guests),
        float(row.checkins_last_15m),
        float(row.pressure_score),
        float(row.show_rate),
        float(local_timestamp.hour * 60 + local_timestamp.minute),
        float(local_timestamp.weekday()),
    ]


def _fallback(current: Any, horizon_minutes: int) -> tuple[float, float, dict[str, float]]:
    capacity = max(1.0, float(current.capacity))
    recent = max(0.0, float(current.checkins_last_15m))
    scheduled = max(0.0, float(current.booked_guests) * float(current.show_rate))
    queue = max(0.0, float(current.queue_guests))
    baseline = max(1.0, recent, capacity * 0.08)
    # A conservative blend: observed movement dominates, scheduled demand and
    # queue are bounded so a bad booking burst cannot produce unsafe claims.
    p50 = min(capacity, baseline * 0.65 + scheduled * 0.025 + queue * 0.05)
    spread = max(2.0, p50 * 0.45)
    p90 = min(capacity, p50 + spread)
    return p50, max(p50, p90), {
        "checkins_last_15m": recent * 0.65,
        "booked_guests": scheduled * 0.025,
        "queue_guests": queue * 0.05,
        "fallback_capacity_rate": capacity * 0.08,
        "horizon_minutes": float(horizon_minutes),
    }


def predict_arrivals(observations: list[Any], current: Any, horizon_minutes: int) -> dict[str, Any]:
    usable = [row for row in observations if row.actual_arrivals_next_15m is not None]
    if len(usable) < MIN_TRAINING_ROWS:
        p50, p90, contributions = _fallback(current, horizon_minutes)
        return {
            "predicted_p50": round(p50, 2),
            "predicted_p90": round(p90, 2),
            "confidence": "LOW",
            "model_version": "arrival_fallback_v2",
            "training_source": "operational_heuristic",
            "used_fallback": True,
            "feature_contributions": contributions,
            "metrics": {"sample_count": len(usable), "minimum_sample_count": MIN_TRAINING_ROWS},
        }

    ordered = sorted(usable, key=lambda row: row.timestamp)
    X = np.asarray([_features(row) for row in ordered], dtype=float)
    y = np.asarray([max(0.0, float(row.actual_arrivals_next_15m)) for row in ordered], dtype=float)
    split = max(1, int(len(ordered) * 0.8))
    if split >= len(ordered):
        split = len(ordered) - 1
    p50_model = GradientBoostingRegressor(
        loss="quantile", alpha=0.5, n_estimators=140, learning_rate=0.04, max_depth=2,
        min_samples_leaf=3, random_state=42,
    )
    p90_model = GradientBoostingRegressor(
        loss="quantile", alpha=0.9, n_estimators=140, learning_rate=0.04, max_depth=2,
        min_samples_leaf=3, random_state=42,
    )
    p50_model.fit(X[:split], y[:split])
    p90_model.fit(X[:split], y[:split])
    validation_p50 = p50_model.predict(X[split:])
    validation_p90 = p90_model.predict(X[split:])
    current_features = np.asarray([_features(current)], dtype=float)
    current_p50 = float(p50_model.predict(current_features)[0])
    current_p90 = float(p90_model.predict(current_features)[0])
    p50 = max(0.0, current_p50 * horizon_minutes / 15.0)
    p90 = max(p50, current_p90 * horizon_minutes / 15.0)

    # Local signed explanations: compare the current prediction with a
    # counterfactual where one feature is replaced by its training median.
    contributions: dict[str, float] = {}
    medians = np.median(X[:split], axis=0)
    for index, name in enumerate(FEATURE_NAMES):
        counterfactual = current_features.copy()
        counterfactual[0, index] = medians[index]
        delta = (
            current_p50 - float(p50_model.predict(counterfactual)[0])
        ) * horizon_minutes / 15.0
        if abs(delta) >= 0.001:
            contributions[name] = round(delta, 4)
    training_source = "demo_operational_history" if any(
        str(getattr(row, "data_source", "")).upper().startswith("DEMO") for row in usable
    ) else "live_operational_history"
    validation_mae = float(mean_absolute_error(y[split:], validation_p50))
    validation_coverage = float(np.mean(y[split:] <= validation_p90))
    normalized_mae = validation_mae / max(1.0, float(np.mean(y[split:])))
    if (
        len(usable) >= 90
        and normalized_mae <= 0.3
        and 0.75 <= validation_coverage <= 1.0
    ):
        confidence = "HIGH"
    elif normalized_mae <= 0.6 and validation_coverage >= 0.6:
        confidence = "MEDIUM"
    else:
        confidence = "LOW"
    return {
        "predicted_p50": round(min(float(current.capacity), p50), 2),
        "predicted_p90": round(min(float(current.capacity), p90), 2),
        "confidence": confidence,
        "model_version": "arrival_gbr_quantile_v2",
        "training_source": training_source,
        "used_fallback": False,
        "feature_contributions": contributions,
        "metrics": {
            "sample_count": len(usable),
            "validation_mae_p50": round(validation_mae, 3),
            "validation_normalized_mae_p50": round(normalized_mae, 3),
            "validation_coverage_p90": round(validation_coverage, 3),
            "time_split": f"{split}/{len(ordered) - split}",
            "explanation_method": "one_feature_counterfactual",
        },
    }


def predict_wait(payload: Any) -> dict[str, Any]:
    arrival = predict_arrivals(payload.observations, payload.current, payload.horizon_minutes)
    throughput_p50 = max(0.5, float(arrival["predicted_p50"]))
    throughput_high = max(throughput_p50, float(arrival["predicted_p90"]))
    throughput_low = max(0.5, throughput_p50 - (throughput_high - throughput_p50))
    guests = max(1, int(payload.guests_ahead) + int(payload.party_size))
    # Arrival rate is a 15-minute count; P90 wait deliberately uses the lower
    # operational throughput bound to avoid promising an unrealistically short ETA.
    wait_p50 = ceil(guests / throughput_p50 * 15)
    wait_p90 = ceil(guests / throughput_low * 15)
    return {
        **arrival,
        "predicted_p50": min(240, max(0, wait_p50)),
        "predicted_p90": min(240, max(wait_p50, wait_p90)),
        "prediction_type": "WAIT_TIME",
        "model_version": f"{arrival['model_version']}:eta",
    }


def _same_day_conflict(left: Any, right: Any, travel_buffer_minutes: int) -> bool:
    return (
        left.day_index == right.day_index
        and left.start_minute < right.end_minute + travel_buffer_minutes
        and right.start_minute < left.end_minute + travel_buffer_minutes
    )


def _score(items: list[Any], travel_buffer_minutes: int) -> float:
    score = 0.0
    for item in items:
        duration = max(1, item.end_minute - item.start_minute)
        score += float(item.priority) * duration / 60.0
        score -= float(item.risk_score) * duration / 100.0
    for left in items:
        for right in items:
            if left.id >= right.id or left.day_index != right.day_index:
                continue
            if _same_day_conflict(left, right, travel_buffer_minutes):
                score -= 1000.0
    return score


def _conflicts(items: list[Any], travel_buffer_minutes: int) -> list[list[str]]:
    conflicts: list[list[str]] = []
    for index, left in enumerate(items):
        for right in items[index + 1:]:
            if _same_day_conflict(left, right, travel_buffer_minutes):
                conflicts.append([left.id, right.id])
    return conflicts


def optimize_schedule(payload: Any) -> dict[str, Any]:
    original = list(payload.items)
    baseline = _score(original, payload.travel_buffer_minutes)
    optimized = list(original)
    for _pass in range(3):
        improved = False
        for index, item in enumerate(optimized):
            if item.locked or item.flexibility_minutes <= 0:
                continue
            allowed_shift = min(payload.max_shift_minutes, item.flexibility_minutes)
            duration = max(1, item.end_minute - item.start_minute)
            best = optimized
            best_score = _score(optimized, payload.travel_buffer_minutes)
            for shift in (-allowed_shift, -allowed_shift // 2, allowed_shift // 2, allowed_shift):
                start = max(0, min(24 * 60 - duration, item.start_minute + shift))
                variant = list(optimized)
                variant[index] = item.model_copy(
                    update={"start_minute": start, "end_minute": start + duration}
                )
                candidate_score = _score(variant, payload.travel_buffer_minutes)
                if candidate_score > best_score:
                    best, best_score = variant, candidate_score
            if best is not optimized:
                optimized = best
                improved = True
        if not improved:
            break
    proposals = [
        {
            "item_id": after.id,
            "original_start_minute": before.start_minute,
            "original_end_minute": before.end_minute,
            "proposed_start_minute": after.start_minute,
            "proposed_end_minute": after.end_minute,
            "reason": "Giảm rủi ro và tránh xung đột khung giờ theo ràng buộc Autopilot",
        }
        for before, after in zip(original, optimized)
        if before.start_minute != after.start_minute or before.end_minute != after.end_minute
    ]
    total_shift = sum(abs(p["proposed_start_minute"] - p["original_start_minute"]) for p in proposals)
    remaining_conflicts = _conflicts(optimized, payload.travel_buffer_minutes)
    return {
        "live_trip_id": payload.live_trip_id,
        "algorithm_version": "constrained_local_search_v2",
        "baseline_score": round(baseline, 2),
        "optimized_score": round(_score(optimized, payload.travel_buffer_minutes), 2),
        # No alternate-slot wait curve is available here, so claiming saved
        # minutes would be fabricated. This field remains for API compatibility.
        "predicted_minutes_saved": 0,
        "total_shift_minutes": int(total_shift),
        "protected_booking_count": sum(1 for item in original if item.locked),
        "proposals": proposals,
        "constraints": {
            "locked_items_immutable": True,
            "max_shift_minutes": payload.max_shift_minutes,
            "travel_buffer_minutes": payload.travel_buffer_minutes,
            "timezone": payload.timezone,
            "day_index_isolated": True,
            "no_overlapping_windows": not remaining_conflicts,
            "constraint_violations": (
                [{"code": "UNRESOLVED_CONFLICT", "item_ids": pair} for pair in remaining_conflicts]
            ),
            "algorithm": "bounded_local_search",
        },
        "generated_at": datetime.now(timezone.utc),
    }
