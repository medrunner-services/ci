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
git -C "$worktree" merge --no-ff release/stable -m 'merge stable release'
git -C "$worktree" merge-base --is-ancestor release/stable main
git -C "$worktree" describe --tags --abbrev=0 HEAD
