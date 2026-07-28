from datetime import datetime, timedelta, timezone
import unittest

from pydantic import ValidationError

from app.live_model import optimize_schedule, predict_arrivals, predict_wait
from app.schemas import (
    LiveObservation,
    OptimizeRequest,
    OptimizerItem,
    WaitPredictionRequest,
)


class LiveArrivalModelTests(unittest.TestCase):
    def test_trained_model_returns_real_quantiles_and_time_split_metrics(self):
        start = datetime(2026, 7, 1, tzinfo=timezone.utc)
        observations = []
        for index in range(36):
            observations.append(
                LiveObservation(
                    timestamp=start + timedelta(minutes=15 * index),
                    capacity=120,
                    booked_guests=50 + index,
                    held_guests=index % 4,
                    queue_guests=(index * 2) % 20,
                    checkins_last_15m=3 + index % 9,
                    pressure_score=45 + index % 40,
                    show_rate=0.9,
                    actual_arrivals_next_15m=4 + index % 10,
                    data_source="TEST_OPERATIONAL",
                )
            )
        result = predict_arrivals(observations, observations[-1], 15)

        self.assertFalse(result["used_fallback"])
        self.assertEqual(result["model_version"], "arrival_gbr_conformal_v3")
        self.assertGreaterEqual(result["predicted_p90"], result["predicted_p50"])
        self.assertLessEqual(
            result["metrics"]["predicted_p10"],
            result["predicted_p50"],
        )
        self.assertEqual(
            result["metrics"]["explanation_method"],
            "one_feature_counterfactual",
        )
        self.assertEqual(
            result["metrics"]["uncertainty_method"],
            "split_conformal_quantile_calibration",
        )
        self.assertIn("validation_coverage_p90", result["metrics"])
        self.assertEqual(result["metrics"]["dropped_future_rows"], 1)

    def test_insufficient_history_is_an_explicit_fallback(self):
        now = datetime(2026, 7, 1, 12, tzinfo=timezone.utc)
        observations = [
            LiveObservation(
                timestamp=now - timedelta(minutes=15 * (20 - index)),
                capacity=100,
                checkins_last_15m=5,
                actual_arrivals_next_15m=6,
            )
            for index in range(20)
        ]
        current = LiveObservation(timestamp=now, capacity=100, checkins_last_15m=4)

        result = predict_arrivals(observations, current, 15)

        self.assertTrue(result["used_fallback"])
        self.assertEqual(result["confidence"], "LOW")
        self.assertIn(
            "INSUFFICIENT_VALIDATED_HISTORY",
            result["metrics"]["confidence_reasons"],
        )

    def test_demo_history_can_never_drive_live_operational_confidence(self):
        start = datetime(2026, 7, 1, tzinfo=timezone.utc)
        observations = [
            LiveObservation(
                timestamp=start + timedelta(minutes=15 * index),
                data_source="DEMO_OPERATIONAL",
                capacity=120,
                booked_guests=60,
                checkins_last_15m=8,
                actual_arrivals_next_15m=8 + index % 3,
            )
            for index in range(120)
        ]
        current = LiveObservation(
            timestamp=start + timedelta(minutes=15 * 120),
            capacity=120,
            booked_guests=60,
            checkins_last_15m=8,
        )

        result = predict_arrivals(observations, current, 15)

        self.assertFalse(result["used_fallback"])
        self.assertEqual(result["confidence"], "LOW")
        self.assertEqual(result["training_source"], "demo_operational_history")
        self.assertIn(
            "DEMO_DATA_NOT_ALLOWED_FOR_LIVE_DECISIONS",
            result["metrics"]["confidence_reasons"],
        )

    def test_wait_prediction_uses_qr_service_throughput_not_arrival_demand(self):
        now = datetime(2026, 7, 1, 12, tzinfo=timezone.utc)
        current = LiveObservation(
            timestamp=now,
            capacity=100,
            booked_guests=30,
            checkins_last_15m=5,
        )
        payload = WaitPredictionRequest(
            attraction_id="attraction-1",
            observations=[],
            current=current,
            horizon_minutes=30,
            guests_ahead=12,
            party_size=3,
        )

        result = predict_wait(payload)

        self.assertEqual(result["predicted_p50"], 36)
        self.assertEqual(result["training_source"], "live_qr_throughput_15m")
        self.assertEqual(result["metrics"]["requested_horizon_minutes"], 30)
        self.assertTrue(result["metrics"]["party_size_excluded_from_own_eta"])
        self.assertGreaterEqual(result["predicted_p90"], result["predicted_p50"])
        self.assertLessEqual(result["predicted_p90"], 240)

    def test_wait_is_monotonic_in_guests_ahead_and_inverse_in_qr_throughput(self):
        now = datetime(2026, 7, 1, 12, tzinfo=timezone.utc)

        def estimate(guests_ahead: int, checkins: int, party_size: int = 1):
            return predict_wait(
                WaitPredictionRequest(
                    attraction_id="attraction-1",
                    observations=[],
                    current=LiveObservation(
                        timestamp=now,
                        capacity=100,
                        booked_guests=90,
                        checkins_last_15m=checkins,
                    ),
                    horizon_minutes=15,
                    guests_ahead=guests_ahead,
                    party_size=party_size,
                )
            )["predicted_p50"]

        self.assertGreater(estimate(20, 5), estimate(10, 5))
        self.assertLess(estimate(20, 10), estimate(20, 5))
        self.assertEqual(estimate(10, 5, 1), estimate(10, 5, 20))
        self.assertEqual(estimate(0, 5), 0)


class ConstrainedOptimizerTests(unittest.TestCase):
    def test_optimizer_schema_rejects_an_inverted_activity_window(self):
        with self.assertRaises(ValidationError):
            OptimizerItem(
                id="invalid",
                start_minute=600,
                end_minute=540,
            )

    def test_same_clock_time_on_different_days_never_conflicts(self):
        payload = OptimizeRequest(
            live_trip_id="trip-1",
            items=[
                OptimizerItem(
                    id="day-1",
                    day_index=0,
                    start_minute=540,
                    end_minute=600,
                    locked=True,
                ),
                OptimizerItem(
                    id="day-2",
                    day_index=1,
                    start_minute=540,
                    end_minute=600,
                    locked=True,
                ),
            ],
        )
        result = optimize_schedule(payload)

        self.assertTrue(result["constraints"]["no_overlapping_windows"])
        self.assertEqual(result["constraints"]["constraint_violations"], [])
        self.assertEqual(result["proposals"], [])

    def test_optimizer_protects_bookings_and_does_not_invent_saved_minutes(self):
        payload = OptimizeRequest(
            live_trip_id="trip-2",
            travel_buffer_minutes=30,
            max_shift_minutes=45,
            items=[
                OptimizerItem(
                    id="paid",
                    day_index=0,
                    start_minute=540,
                    end_minute=600,
                    locked=True,
                    priority=100,
                ),
                OptimizerItem(
                    id="flexible",
                    day_index=0,
                    start_minute=610,
                    end_minute=670,
                    locked=False,
                    flexibility_minutes=45,
                ),
            ],
        )
        result = optimize_schedule(payload)

        paid_proposals = [
            proposal for proposal in result["proposals"]
            if proposal["item_id"] == "paid"
        ]
        self.assertEqual(paid_proposals, [])
        self.assertEqual(result["protected_booking_count"], 1)
        self.assertEqual(result["predicted_minutes_saved"], 0)
        self.assertGreaterEqual(result["total_shift_minutes"], 0)


if __name__ == "__main__":
    unittest.main()
