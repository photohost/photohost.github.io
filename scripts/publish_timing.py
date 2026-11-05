"""Add non-identifying publication latency measurements to the Actions summary."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import sys
import urllib.request


def parse_time(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00")) if value else None


def seconds(start, end):
    if start is None or end is None:
        return "—"
    return f"{max(0, round((end - start).total_seconds()))} 秒"


def github_json(path):
    request = urllib.request.Request("https://api.github.com" + path, headers={
        "Authorization": "Bearer " + os.environ["GITHUB_TOKEN"],
        "Accept": "application/vnd.github+json",
        "User-Agent": "gmeek-publish-timing",
    })
    with urllib.request.urlopen(request, timeout=6) as response:
        return json.load(response)


def report(complete=False):
    first_step = datetime.now(timezone.utc)
    run_id = os.environ["GITHUB_RUN_ID"]
    repo = os.environ["GITHUB_REPOSITORY"]
    dispatched = parse_time(os.environ.get("WORKER_DISPATCHED_AT", ""))
    try:
        run = github_json(f"/repos/{repo}/actions/runs/{run_id}")
        jobs = github_json(f"/repos/{repo}/actions/runs/{run_id}/jobs?per_page=20")["jobs"]
        created = parse_time(run.get("created_at", ""))
        job = next((item for item in jobs if item.get("name") == "Sync and generate blog"), None)
        deploy = next((item for item in jobs if item.get("name") == "Deploy blog"), None)
        started = parse_time(job.get("started_at", "")) if job else None
        build_done = parse_time(job.get("completed_at", "")) if job else None
        deploy_started = parse_time(deploy.get("started_at", "")) if deploy else None
        deploy_done = parse_time(deploy.get("completed_at", "")) if deploy else None
    except (OSError, ValueError, KeyError, StopIteration):
        created = started = build_done = deploy_started = deploy_done = None

    def worker_ms(name):
        value = os.environ.get(name, "")
        return f"{int(value) / 1000:.1f} 秒" if value.isdigit() and int(value) < 172800000 else "—"

    rows = [
        ("Notion 事件 → Webhook 收到", worker_ms("NOTION_TO_WEBHOOK_MS")),
        ("Webhook 收到 → 派送 GitHub（含合併等待與忙碌重試）", worker_ms("WEBHOOK_TO_DISPATCH_MS")),
        ("派送 GitHub → 工作建立", seconds(dispatched, created)),
        ("工作建立 → 執行器開始（排隊）", seconds(created, started)),
    ]
    if complete:
        rows.extend([
            ("網站建置", seconds(started, build_done)),
            ("建置完成 → 部署開始（部署排隊）", seconds(build_done, deploy_started)),
            ("網站部署", seconds(deploy_started, deploy_done)),
        ])
    else:
        rows.append(("執行器開始 → 量測步驟（啟動與取碼）", seconds(started, first_step)))
    summary = ("## Notion 發布完整時間\n\n" if complete else "## Notion 發布觸發時間\n\n")
    summary += "此表以這批通知中最早收到的事件為起點；未量到的階段顯示「—」。\n\n"
    summary += "| 階段 | 時間 |\n| --- | ---: |\n"
    summary += "".join(f"| {name} | {duration} |\n" for name, duration in rows)
    print(summary)
    if os.environ.get("GITHUB_STEP_SUMMARY"):
        with Path(os.environ["GITHUB_STEP_SUMMARY"]).open("a", encoding="utf-8") as output:
            output.write(summary)


if __name__ == "__main__":
    report("--complete" in sys.argv)
