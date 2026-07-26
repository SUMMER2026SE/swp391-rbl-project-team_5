from datetime import datetime, timedelta, timezone
import unittest

from app.live_model import optimize_schedule, predict_arrivals
from app.schemas import LiveObservation, OptimizeRequest, OptimizerItem


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
        self.assertEqual(result["model_version"], "arrival_gbr_quantile_v2")
        self.assertGreaterEqual(result["predicted_p90"], result["predicted_p50"])
        self.assertEqual(
            result["metrics"]["explanation_method"],
            "one_feature_counterfactual",
        )
        self.assertIn("validation_coverage_p90", result["metrics"])


class ConstrainedOptimizerTests(unittest.TestCase):
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
