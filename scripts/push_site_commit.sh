#!/usr/bin/env bash
set -euo pipefail

# Push one workflow-created commit without overwriting newer work on the branch.
branch=${GITHUB_REF_NAME:?Missing branch name}
destination="refs/heads/$branch"

for attempt in 1 2 3; do
    if result=$(git push --porcelain origin "HEAD:$destination" 2>&1); then
        printf '%s\n' "$result"
        exit 0
    fi
    printf '%s\n' "$result"
    case "$result" in
        *'[rejected] (fetch first)'*|*'[rejected] (non-fast-forward)'*) ;;
        *) exit 1 ;;
    esac
    if [[ "$attempt" == 3 ]]; then
        echo "::error::Branch kept advancing after two recovery attempts."
        exit 1
    fi

    git fetch --no-tags origin "$destination"
    remote=$(git rev-parse FETCH_HEAD)
    parent=$(git rev-parse HEAD^)
    if ! git merge-base --is-ancestor "$parent" "$remote"; then
        echo "::error::Branch history changed. Rebuild from the latest branch."
        exit 1
    fi
    # A clean rebase alone is insufficient: newer inputs can make the output stale.
    if ! git diff --quiet "$parent" "$remote" -- \
        config.json scripts static docs backup blogBase.json README.md .gmeek-build.json \
        .notion-sync .github/workflows/Gmeek.yml; then
        echo "::error::Newer site inputs or generated files detected. Rebuild from the latest branch."
        exit 1
    fi
    echo "Branch advanced on unrelated files; replaying the workflow commit (attempt $attempt)."
    if ! git -c rebase.autoStash=false rebase --onto "$remote" "$parent"; then
        git rebase --abort
        exit 1
    fi
done
