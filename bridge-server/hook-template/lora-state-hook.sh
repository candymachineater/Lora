#!/bin/bash
# Lora Claude Code State Hook
# Receives notification events via stdin and writes state to a file
# for the bridge server to monitor

# Read JSON input from stdin
INPUT=$(cat)

# Extract notification_type from JSON
NOTIFICATION_TYPE=$(echo "$INPUT" | jq -r '.notification_type // empty')

# Only process if we have a LORA_SESSION (set by bridge server in tmux)
if [ -z "$LORA_SESSION" ]; then
  exit 0
fi

STATE_FILE="/tmp/lora-claude-state-$LORA_SESSION.json"
TIMESTAMP=$(date +%s000)

case "$NOTIFICATION_TYPE" in
  "permission_prompt")
    echo "{\"state\":\"permission\",\"timestamp\":$TIMESTAMP,\"type\":\"$NOTIFICATION_TYPE\"}" > "$STATE_FILE"
    ;;
  "idle_prompt")
    echo "{\"state\":\"idle\",\"timestamp\":$TIMESTAMP,\"type\":\"$NOTIFICATION_TYPE\"}" > "$STATE_FILE"
    ;;
  *)
    # Unknown type, ignore
    ;;
esac

exit 0
