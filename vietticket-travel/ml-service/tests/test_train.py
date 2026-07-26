import unittest
from datetime import date, timedelta
from tempfile import TemporaryDirectory

import pandas as pd

from app.train import _add_lag_and_rolling_features, load_training_csv


class TrainingDataQualityTests(unittest.TestCase):
    def test_csv_loader_rejects_empty_real_dataset_with_actionable_error(self):
        with TemporaryDirectory() as directory:
            path = f"{directory}/empty.csv"
            pd.DataFrame(
                columns=[
                    "attraction_id",
                    "date",
                    "tier",
                    "city",
                    "capacity",
                    "avg_ticket_price",
                    "rating",
                    "num_reviews",
                    "revenue",
                    "tickets",
                ]
            ).to_csv(path, index=False)
            with self.assertRaisesRegex(ValueError, "không có dòng dữ liệu thật"):
                load_training_csv(path)

    def test_early_lags_use_only_past_data_and_never_full_future_mean(self):
        revenue = pd.DataFrame(
            [
                {"attraction_id": "a", "date": date(2026, 1, 1), "revenue": 10, "tickets": 1},
                {"attraction_id": "a", "date": date(2026, 1, 2), "revenue": 1000, "tickets": 2},
                {"attraction_id": "a", "date": date(2026, 1, 3), "revenue": 20, "tickets": 3},
            ]
        )

        result = _add_lag_and_rolling_features(revenue)

        self.assertEqual(result.iloc[0]["lag_1"], 0)
        self.assertEqual(result.iloc[0]["roll_mean_7"], 0)
        self.assertEqual(result.iloc[1]["lag_7"], 10)
        self.assertEqual(result.iloc[2]["lag_7"], 505)

    def test_csv_loader_rejects_duplicate_attraction_day_rows(self):
        rows = []
        start = date.today() - timedelta(days=120)
        for attraction_index in range(3):
            for day_index in range(90):
                rows.append(
                    {
                        "attraction_id": f"a-{attraction_index}",
                        "date": start + timedelta(days=day_index),
                        "tier": "STANDARD",
                        "city": "Da Nang",
                        "capacity": 100,
                        "avg_ticket_price": 100000,
                        "rating": 4.5,
                        "num_reviews": 20,
                        "revenue": 1000000,
                        "tickets": 10,
                    }
                )
        frame = pd.DataFrame(rows)
        frame = pd.concat([frame, frame.iloc[[0]]], ignore_index=True)

        with TemporaryDirectory() as directory:
            path = f"{directory}/history.csv"
            frame.to_csv(path, index=False)
            with self.assertRaisesRegex(ValueError, "cùng attraction_id"):
                load_training_csv(path)


if __name__ == "__main__":
    unittest.main()
