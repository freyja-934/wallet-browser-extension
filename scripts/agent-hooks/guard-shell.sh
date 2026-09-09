#!/usr/bin/env bash
set -u
CMD=$(cat | jq -r '.tool_input.command // .command // empty' 2>/dev/null)
[ -z "${CMD:-}" ] && exit 0
deny() { echo "Blocked by guard-shell.sh: $1" >&2; exit 2; }
case "$CMD" in
  *"git push"*"--force"*|*"git push -f"*) deny "force push" ;;
  *"git push"*origin*main*|*"git push origin main"*|*"git push -u origin main"*) deny "pushing to the default branch — open a PR" ;;
  *"git reset --hard"*) deny "hard reset — ask the human" ;;
  *"rm -rf /"*|*"rm -rf ~"*) deny "destructive rm" ;;
esac
exit 0
