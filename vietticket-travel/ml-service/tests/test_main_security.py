import unittest
from tempfile import TemporaryDirectory
from pathlib import Path

from fastapi import HTTPException

from app import main
from app.model import EnsembleForecastModel


class MlServiceSecurityTests(unittest.TestCase):
    def setUp(self):
        self.original_environment = main.settings.environment
        self.original_api_key = main.settings.ml_service_api_key
        self.original_model = main._model

    def tearDown(self):
        main.settings.environment = self.original_environment
        main.settings.ml_service_api_key = self.original_api_key
        main._model = self.original_model

    def test_production_requires_a_strong_internal_api_key(self):
        main.settings.environment = "production"
        main.settings.ml_service_api_key = "weak"

        with self.assertRaises(RuntimeError):
            main.validate_runtime_security()

    def test_api_key_comparison_rejects_an_invalid_key(self):
        main.settings.ml_service_api_key = "a-secure-internal-key-with-more-than-32-characters"

        with self.assertRaises(HTTPException) as context:
            main.require_api_key("incorrect")

        self.assertEqual(context.exception.status_code, 401)
        self.assertTrue(
            main.require_api_key(
                "a-secure-internal-key-with-more-than-32-characters"
            )
        )

    def test_production_rejects_a_demo_revenue_model(self):
        class DemoModel:
            metrics = {"training_source": "demo_booking_history"}
            artifact_integrity_verified = True

        main.settings.environment = "production"
        main._model = DemoModel()

        with self.assertRaises(RuntimeError):
            main.validate_model_provenance()

    def test_model_artifact_hash_detects_tampering(self):
        with TemporaryDirectory() as model_dir:
            model = EnsembleForecastModel(
                metrics={"training_source": "real_booking_history"},
            )
            model.save(model_dir)
            loaded = EnsembleForecastModel.load(model_dir)
            self.assertTrue(loaded.artifact_integrity_verified)

            model_path = Path(model_dir) / "ensemble_model.joblib"
            with model_path.open("ab") as artifact:
                artifact.write(b"tampered")

            with self.assertRaises(ValueError):
                EnsembleForecastModel.load(model_dir)


if __name__ == "__main__":
    unittest.main()
