#!/usr/bin/env bash
set -u
PATH_VAL=$(cat | jq -r '.tool_input.file_path // .file_path // .path // empty' 2>/dev/null)
[ -z "${PATH_VAL:-}" ] && exit 0
deny() { echo "Blocked by protect-files.sh: $1" >&2; exit 2; }

base=$(basename "$PATH_VAL")
case "$PATH_VAL" in
  *.env.example) exit 0 ;;
esac
case "$base" in
  .env|.env.*) deny "env files are off limits" ;;
  pnpm-lock.yaml) deny "lockfile is protected" ;;
esac
case "$PATH_VAL" in
  *.github/workflows/*|.github/workflows/*) deny "CI workflows are protected" ;;
  *.pem) deny "private keys are off limits" ;;
esac
exit 0
