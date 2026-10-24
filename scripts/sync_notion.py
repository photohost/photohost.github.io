"""CLI entry point for the Notion publisher. Preview/publish must be explicit."""
import sys
from notion_sync import main, SyncError

if __name__ == "__main__":
    try:
        main()
    except SyncError as exc:
        print("Sync stopped: " + str(exc), file=sys.stderr)
        sys.exit(1)
