from datetime import datetime, timezone
from pathlib import Path
import os
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import publish_timing


class PublishTimingTests(unittest.TestCase):
    def test_summary_separates_worker_wait_and_github_queue(self):
        with tempfile.TemporaryDirectory() as directory:
            summary = Path(directory) / "summary.md"
            env = {"GITHUB_RUN_ID": "123", "GITHUB_REPOSITORY": "photohost/photohost.github.io",
                   "GITHUB_STEP_SUMMARY": str(summary), "NOTION_TO_WEBHOOK_MS": "3500",
                   "WEBHOOK_TO_DISPATCH_MS": "80000",
                   "WORKER_DISPATCHED_AT": "2026-11-05T10:00:00Z"}
            def github(path):
                if path.endswith("/jobs?per_page=20"):
                    return {"jobs": [{"name": "Sync and generate blog", "started_at": "2026-11-05T10:00:12Z"}]}
                return {"created_at": "2026-11-05T10:00:02Z"}
            with patch.dict(os.environ, env), patch.object(publish_timing, "github_json", side_effect=github):
                publish_timing.report()
            text = summary.read_text(encoding="utf-8")
            self.assertIn("3.5 秒", text)
            self.assertIn("80.0 秒", text)
            self.assertIn("派送 GitHub → 工作建立 | 2 秒", text)
            self.assertIn("工作建立 → 執行器開始（排隊） | 10 秒", text)
            self.assertNotIn("photohost/", text)


if __name__ == "__main__":
    unittest.main()
