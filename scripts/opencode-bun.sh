#!/bin/sh
# Run OpenCode's embedded Bun runtime without changing OpenCode's normal CLI.
exec env BUN_BE_BUN=1 /usr/local/bin/opencode "$@"
