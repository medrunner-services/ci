#!/usr/bin/env bash
set -euo pipefail

worktree="$(mktemp -d)"
trap 'rm -rf "$worktree"' EXIT

git -C "$worktree" init --initial-branch=main
git -C "$worktree" config user.name fixture
git -C "$worktree" config user.email fixture@example.invalid
printf 'base\n' > "$worktree/version.txt"
git -C "$worktree" add version.txt
git -C "$worktree" commit -m 'feat: base'
git -C "$worktree" switch -c release/stable
printf 'stable\n' >> "$worktree/version.txt"
git -C "$worktree" commit -am 'feat: stable release'
git -C "$worktree" tag v1.0.0
git -C "$worktree" switch main

if git -C "$worktree" merge-base --is-ancestor release/stable main; then
  echo 'release/stable unexpectedly reachable from main' >&2
  exit 1
fi

git -C "$worktree" describe --tags --exact-match release/stable
