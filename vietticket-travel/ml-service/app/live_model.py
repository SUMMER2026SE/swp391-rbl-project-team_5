"""Small, explainable operational models for LiveTrip.

The service intentionally trains only from timestamped observations supplied by
the Node API. It never invents a production claim: below the minimum history
the response is a labelled, deterministic fallback with conservative intervals.
"""

from __future__ import annotations

from datetime import datetime, timezone
from math import ceil, cos, pi, sin
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
    "expected_guests",
    "occupancy_ratio",
    "queue_ratio",
    "throughput_ratio",
    "minute_of_day",
    "day_of_week",
    "minute_sin",
    "minute_cos",
    "day_of_week_sin",
    "day_of_week_cos",
]
MIN_TRAINING_ROWS = 32
MIN_VALIDATION_ROWS = 8
MEDIUM_CONFIDENCE_ROWS = 96
HIGH_CONFIDENCE_ROWS = 7 * 24 * 4
MEDIUM_CONFIDENCE_SPAN_HOURS = 24
HIGH_CONFIDENCE_SPAN_HOURS = 7 * 24
MAX_HISTORY_STALENESS_MINUTES = 120
RECENCY_HALF_LIFE_HOURS = 7 * 24
VIETNAM_TIMEZONE = ZoneInfo("Asia/Ho_Chi_Minh")


def _timestamp(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _features(row: Any) -> list[float]:
    timestamp = _timestamp(row.timestamp)
    local_timestamp = timestamp.astimezone(VIETNAM_TIMEZONE)
    capacity = max(1.0, float(row.capacity))
    booked = max(0.0, float(row.booked_guests))
    held = max(0.0, float(row.held_guests))
    queue = max(0.0, float(row.queue_guests))
    recent = max(0.0, float(row.checkins_last_15m))
    show_rate = min(1.0, max(0.0, float(row.show_rate)))
    expected_guests = booked * show_rate
    minute_of_day = local_timestamp.hour * 60 + local_timestamp.minute
    day_of_week = local_timestamp.weekday()
    minute_angle = 2 * pi * minute_of_day / (24 * 60)
    day_angle = 2 * pi * day_of_week / 7
    return [
        capacity,
        booked,
        held,
        queue,
        recent,
        float(row.pressure_score),
        show_rate,
        expected_guests,
        min(3.0, (expected_guests + held) / capacity),
        min(3.0, queue / capacity),
        min(3.0, recent / capacity),
        float(minute_of_day),
        float(day_of_week),
        sin(minute_angle),
        cos(minute_angle),
        sin(day_angle),
        cos(day_angle),
    ]


def _prepare_observations(
    observations: list[Any],
    current: Any,
) -> tuple[list[Any], dict[str, Any]]:
    current_timestamp = _timestamp(current.timestamp)
    by_timestamp: dict[datetime, Any] = {}
    dropped_future = 0
    dropped_invalid = 0
    duplicate_rows = 0
    clipped_targets = 0

    for row in observations:
        if row.actual_arrivals_next_15m is None:
            continue
        timestamp = _timestamp(row.timestamp)
        if timestamp >= current_timestamp:
            dropped_future += 1
            continue
        try:
            features = np.asarray(_features(row), dtype=float)
            target = float(row.actual_arrivals_next_15m)
        except (TypeError, ValueError, OverflowError):
            dropped_invalid += 1
            continue
        if not np.all(np.isfinite(features)) or not np.isfinite(target) or target < 0:
            dropped_invalid += 1
            continue
        if float(row.capacity) > 0 and target > float(row.capacity):
            clipped_targets += 1
        if timestamp in by_timestamp:
            duplicate_rows += 1
        by_timestamp[timestamp] = row

    ordered = [by_timestamp[key] for key in sorted(by_timestamp)]
    latest_timestamp = _timestamp(ordered[-1].timestamp) if ordered else None
    earliest_timestamp = _timestamp(ordered[0].timestamp) if ordered else None
    history_span_hours = (
        (latest_timestamp - earliest_timestamp).total_seconds() / 3600
        if latest_timestamp and earliest_timestamp
        else 0.0
    )
    latest_age_minutes = (
        max(0.0, (current_timestamp - latest_timestamp).total_seconds() / 60)
        if latest_timestamp
        else None
    )
    return ordered, {
        "raw_observation_count": len(observations),
        "usable_sample_count": len(ordered),
        "duplicate_timestamp_rows": duplicate_rows,
        "dropped_future_rows": dropped_future,
        "dropped_invalid_rows": dropped_invalid,
        "clipped_target_rows": clipped_targets,
        "history_span_hours": round(history_span_hours, 2),
        "latest_observation_age_minutes": (
            round(latest_age_minutes, 2) if latest_age_minutes is not None else None
        ),
    }


def _target(row: Any) -> float:
    target = max(0.0, float(row.actual_arrivals_next_15m))
    capacity = max(0.0, float(row.capacity))
    return min(capacity, target) if capacity > 0 else target


def _recency_weights(rows: list[Any]) -> np.ndarray:
    newest = _timestamp(rows[-1].timestamp)
    ages = np.asarray(
        [
            max(0.0, (newest - _timestamp(row.timestamp)).total_seconds() / 3600)
            for row in rows
        ],
        dtype=float,
    )
    return np.clip(np.power(0.5, ages / RECENCY_HALF_LIFE_HOURS), 0.2, 1.0)


def _quantile_model(alpha: float) -> GradientBoostingRegressor:
    return GradientBoostingRegressor(
        loss="quantile",
        alpha=alpha,
        n_estimators=180,
        learning_rate=0.035,
        max_depth=2,
        min_samples_leaf=4,
        subsample=0.9,
        random_state=42,
    )


def _fallback(current: Any, horizon_minutes: int) -> tuple[float, float, dict[str, float]]:
    capacity = max(1.0, float(current.capacity))
    recent = max(0.0, float(current.checkins_last_15m))
    scheduled = max(0.0, float(current.booked_guests) * float(current.show_rate))
    queue = max(0.0, float(current.queue_guests))
    baseline = max(1.0, recent, capacity * 0.08)
    # A conservative blend: observed movement dominates, scheduled demand and
    # queue are bounded so a bad booking burst cannot produce unsafe claims.
    horizon_scale = max(1.0 / 3.0, float(horizon_minutes) / 15.0)
    p50 = min(
        capacity,
        (baseline * 0.65 + scheduled * 0.025 + queue * 0.05) * horizon_scale,
    )
    spread = max(2.0, p50 * 0.45)
    p90 = min(capacity, p50 + spread)
    return p50, max(p50, p90), {
        "checkins_last_15m": recent * 0.65 * horizon_scale,
        "booked_guests": scheduled * 0.025 * horizon_scale,
        "queue_guests": queue * 0.05 * horizon_scale,
        "fallback_capacity_rate": capacity * 0.08 * horizon_scale,
        "horizon_minutes": float(horizon_minutes),
    }


def predict_arrivals(observations: list[Any], current: Any, horizon_minutes: int) -> dict[str, Any]:
    usable, quality = _prepare_observations(observations, current)
    if len(usable) < MIN_TRAINING_ROWS:
        p50, p90, contributions = _fallback(current, horizon_minutes)
        p10 = max(0.0, p50 - (p90 - p50))
        return {
            "predicted_p50": round(p50, 2),
            "predicted_p90": round(p90, 2),
            "confidence": "LOW",
            "model_version": "arrival_fallback_v3",
            "training_source": "operational_heuristic",
            "used_fallback": True,
            "feature_contributions": contributions,
            "metrics": {
                **quality,
                "sample_count": len(usable),
                "minimum_sample_count": MIN_TRAINING_ROWS,
                "predicted_p10": round(p10, 2),
                "confidence_reasons": ["INSUFFICIENT_VALIDATED_HISTORY"],
            },
        }

    X = np.asarray([_features(row) for row in usable], dtype=float)
    y = np.asarray([_target(row) for row in usable], dtype=float)
    validation_rows = max(MIN_VALIDATION_ROWS, int(ceil(len(usable) * 0.2)))
    validation_rows = min(validation_rows, len(usable) - (MIN_TRAINING_ROWS - MIN_VALIDATION_ROWS))
    split = len(usable) - validation_rows
    train_rows = usable[:split]
    sample_weights = _recency_weights(train_rows)

    p10_model = _quantile_model(0.1)
    p50_model = _quantile_model(0.5)
    p90_model = _quantile_model(0.9)
    p10_model.fit(X[:split], y[:split], sample_weight=sample_weights)
    p50_model.fit(X[:split], y[:split], sample_weight=sample_weights)
    p90_model.fit(X[:split], y[:split], sample_weight=sample_weights)
    validation_p10 = p10_model.predict(X[split:])
    validation_p50 = p50_model.predict(X[split:])
    validation_p90 = p90_model.predict(X[split:])

    # Split-conformal calibration uses only the newest holdout window. It
    # corrects systematic under/over-prediction without seeing the future
    # target currently being predicted.
    p10_calibration = float(np.quantile(np.maximum(validation_p10 - y[split:], 0.0), 0.9))
    p90_calibration = float(np.quantile(np.maximum(y[split:] - validation_p90, 0.0), 0.9))
    p50_bias = float(np.median(y[split:] - validation_p50))
    max_bias = max(2.0, float(np.std(y[:split])) * 2.0)
    p50_bias = float(np.clip(p50_bias, -max_bias, max_bias))
    calibrated_validation_p10 = np.maximum(0.0, validation_p10 - p10_calibration)
    calibrated_validation_p50 = np.maximum(0.0, validation_p50 + p50_bias)
    calibrated_validation_p90 = np.maximum(
        calibrated_validation_p50,
        validation_p90 + p90_calibration,
    )

    current_features = np.asarray([_features(current)], dtype=float)
    current_p10 = max(
        0.0,
        float(p10_model.predict(current_features)[0]) - p10_calibration,
    )
    current_p50 = max(
        current_p10,
        float(p50_model.predict(current_features)[0]) + p50_bias,
    )
    current_p90 = max(
        current_p50,
        float(p90_model.predict(current_features)[0]) + p90_calibration,
    )
    horizon_scale = horizon_minutes / 15.0
    capacity = max(1.0, float(current.capacity))
    p10 = min(capacity, current_p10 * horizon_scale)
    p50 = min(capacity, max(p10, current_p50 * horizon_scale))
    p90 = min(capacity, max(p50, current_p90 * horizon_scale))

    # Local signed explanations: compare the current prediction with a
    # counterfactual where one feature is replaced by its training median.
    contributions: dict[str, float] = {}
    medians = np.median(X[:split], axis=0)
    for index, name in enumerate(FEATURE_NAMES):
        counterfactual = current_features.copy()
        counterfactual[0, index] = medians[index]
        delta = (
            float(p50_model.predict(current_features)[0])
            - float(p50_model.predict(counterfactual)[0])
        ) * horizon_scale
        if abs(delta) >= 0.001:
            contributions[name] = round(delta, 4)

    data_sources = {
        str(getattr(row, "data_source", "UNKNOWN") or "UNKNOWN").upper()
        for row in usable
    }
    has_demo_source = any(source.startswith("DEMO") for source in data_sources)
    training_source = (
        "demo_operational_history"
        if has_demo_source
        else "live_operational_history"
        if data_sources == {"LIVE_OPERATIONAL"}
        else "mixed_operational_history"
    )
    validation_mae = float(mean_absolute_error(y[split:], calibrated_validation_p50))
    raw_p90_coverage = float(np.mean(y[split:] <= validation_p90))
    validation_p90_coverage = float(np.mean(y[split:] <= calibrated_validation_p90))
    validation_interval_coverage = float(np.mean(
        (y[split:] >= calibrated_validation_p10)
        & (y[split:] <= calibrated_validation_p90)
    ))
    normalized_mae = validation_mae / max(1.0, float(np.mean(y[split:])))
    history_span_hours = float(quality["history_span_hours"])
    latest_age_minutes = quality["latest_observation_age_minutes"]
    confidence_reasons: list[str] = []
    if has_demo_source:
        confidence_reasons.append("DEMO_DATA_NOT_ALLOWED_FOR_LIVE_DECISIONS")
    if (
        latest_age_minutes is None
        or float(latest_age_minutes) > MAX_HISTORY_STALENESS_MINUTES
    ):
        confidence_reasons.append("STALE_OPERATIONAL_HISTORY")

    if (
        not confidence_reasons
        and len(usable) >= HIGH_CONFIDENCE_ROWS
        and history_span_hours >= HIGH_CONFIDENCE_SPAN_HOURS
        and normalized_mae <= 0.3
        and 0.8 <= validation_p90_coverage <= 1.0
        and validation_interval_coverage >= 0.75
    ):
        confidence = "HIGH"
    elif (
        not confidence_reasons
        and len(usable) >= MEDIUM_CONFIDENCE_ROWS
        and history_span_hours >= MEDIUM_CONFIDENCE_SPAN_HOURS
        and normalized_mae <= 0.6
        and validation_p90_coverage >= 0.7
        and validation_interval_coverage >= 0.6
    ):
        confidence = "MEDIUM"
    else:
        confidence = "LOW"
        if len(usable) < MEDIUM_CONFIDENCE_ROWS:
            confidence_reasons.append("LIMITED_SAMPLE_COUNT")
        if history_span_hours < MEDIUM_CONFIDENCE_SPAN_HOURS:
            confidence_reasons.append("LIMITED_TIME_COVERAGE")
        if normalized_mae > 0.6:
            confidence_reasons.append("VALIDATION_ERROR_TOO_HIGH")
        if validation_p90_coverage < 0.7:
            confidence_reasons.append("P90_COVERAGE_TOO_LOW")
        if validation_interval_coverage < 0.6:
            confidence_reasons.append("INTERVAL_COVERAGE_TOO_LOW")

    return {
        "predicted_p50": round(p50, 2),
        "predicted_p90": round(p90, 2),
        "confidence": confidence,
        "model_version": "arrival_gbr_conformal_v3",
        "training_source": training_source,
        "used_fallback": False,
        "feature_contributions": contributions,
        "metrics": {
            **quality,
            "sample_count": len(usable),
            "training_rows": split,
            "validation_rows": validation_rows,
            "validation_mae_p50": round(validation_mae, 3),
            "validation_normalized_mae_p50": round(normalized_mae, 3),
            "validation_coverage_p90_raw": round(raw_p90_coverage, 3),
            "validation_coverage_p90": round(validation_p90_coverage, 3),
            "validation_interval_coverage_p10_p90": round(validation_interval_coverage, 3),
            "p10_conformal_adjustment": round(p10_calibration, 3),
            "p50_bias_adjustment": round(p50_bias, 3),
            "p90_conformal_adjustment": round(p90_calibration, 3),
            "predicted_p10": round(p10, 2),
            "time_split": f"{split}/{validation_rows}",
            "recency_half_life_hours": RECENCY_HALF_LIFE_HOURS,
            "data_sources": sorted(data_sources),
            "confidence_reasons": sorted(set(confidence_reasons)),
            "explanation_method": "one_feature_counterfactual",
            "uncertainty_method": "split_conformal_quantile_calibration",
        },
    }


def predict_wait(payload: Any) -> dict[str, Any]:
    arrival = predict_arrivals(payload.observations, payload.current, payload.horizon_minutes)
    horizon_minutes = max(5, int(payload.horizon_minutes))
    throughput_p50 = max(0.5, float(arrival["predicted_p50"]))
    throughput_p10 = max(
        0.5,
        float(arrival.get("metrics", {}).get("predicted_p10", 0.0)),
    )
    guests = max(1, int(payload.guests_ahead) + int(payload.party_size))
    # Convert the predicted count back to a per-minute service rate. This keeps
    # ETA mathematically correct for every supported prediction horizon.
    wait_p50 = ceil(guests / (throughput_p50 / horizon_minutes))
    wait_p90 = ceil(guests / (throughput_p10 / horizon_minutes))
    return {
        **arrival,
        "predicted_p50": min(240, max(0, wait_p50)),
        "predicted_p90": min(240, max(wait_p50, wait_p90)),
        "prediction_type": "WAIT_TIME",
        "model_version": f"{arrival['model_version']}:eta",
        "metrics": {
            **arrival.get("metrics", {}),
            "arrival_throughput_p10": round(throughput_p10, 2),
            "arrival_throughput_p50": round(throughput_p50, 2),
            "arrival_horizon_minutes": horizon_minutes,
            "wait_formula": "guests_divided_by_conservative_throughput_rate",
        },
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
