#!/usr/bin/env sh

set -eu

if [ -n "${CI:-}" ]; then
  exit 0
fi

effect_upstream="https://github.com/Effect-TS/effect.git"
effect_ref="effect@4.0.0-beta.107"
script_dir="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
repo_dir="$(dirname "$script_dir")/.repos/effect"

for git_variable in $(git rev-parse --local-env-vars); do
  unset "$git_variable"
done

if [ -e "$repo_dir" ] && [ ! -d "$repo_dir/.git" ]; then
  echo "Effect source path exists but is not a Git checkout: $repo_dir" >&2
  exit 1
fi

if [ ! -d "$repo_dir/.git" ]; then
  mkdir -p "$repo_dir"
  git -C "$repo_dir" init --quiet
fi

if [ -n "$(git -C "$repo_dir" status --porcelain=v1)" ]; then
  echo "Effect source checkout has local changes: $repo_dir" >&2
  echo "Commit, stash, or remove those changes before running this command again." >&2
  exit 1
fi

current_remote="$(git -C "$repo_dir" remote get-url origin 2>/dev/null || true)"
if [ -z "$current_remote" ]; then
  git -C "$repo_dir" remote add origin "$effect_upstream"
elif [ "$current_remote" != "$effect_upstream" ]; then
  git -C "$repo_dir" remote set-url origin "$effect_upstream"
fi

git -C "$repo_dir" fetch --depth 1 --force origin "refs/tags/$effect_ref:refs/tags/$effect_ref"
target_commit="$(git -C "$repo_dir" rev-list -n 1 "$effect_ref")"
current_commit="$(git -C "$repo_dir" rev-parse HEAD 2>/dev/null || true)"

if [ "$current_commit" != "$target_commit" ]; then
  git -C "$repo_dir" checkout --detach "$target_commit"
fi

printf 'Effect source ready at %s (%s)\n' "$repo_dir" "$effect_ref"
