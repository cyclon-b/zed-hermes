#!/bin/sh
# Install zed-hermes for the current user and register it in Zed.
#
# Usage:
#   ./install.sh              # write config + register in Zed
#   ./install.sh --no-zed     # write config, print the Zed snippet
#   ./install.sh --revert     # remove the agent from Zed settings
#   ./install.sh --name Hermes
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
NAME="Hermes"
NO_ZED=0
REVERT=0

while [ $# -gt 0 ]; do
  case "$1" in
    --no-zed) NO_ZED=1 ;;
    --revert) REVERT=1 ;;
    --name) shift; NAME=${1:?--name requires a value} ;;
    --help|-h)
      sed -n '2,10p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      exit 2
      ;;
  esac
  shift
done

echo "==> Checking Node.js"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is required (>= 22)." >&2
  exit 1
fi
NODE_VERSION=$(node --version)
NODE_MAJOR=$(printf '%s' "$NODE_VERSION" | sed 's/^v//; s/\..*//')
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "Node.js >= 22 is required, found $NODE_VERSION" >&2
  exit 1
fi
echo "    node $NODE_VERSION"

if [ "$REVERT" -eq 1 ]; then
  if [ "$NO_ZED" -eq 0 ]; then
    node "$ROOT/scripts/register-zed.mjs" --revert --name "$NAME"
  fi
  echo "Reverted. The per-user config was left in place; delete it manually if you no longer need it."
  exit 0
fi

echo "==> Checking Hermes Agent"
if ! command -v hermes >/dev/null 2>&1; then
  echo "    warning: hermes is not on PATH. Install Hermes Agent, or set a custom command in the bridge config." >&2
else
  echo "    $(command -v hermes)"
  if ! hermes acp --version >/dev/null 2>&1; then
    echo "    warning: 'hermes acp --version' failed. Install the ACP extra in the Hermes checkout:" >&2
    echo "    python -c \"import pm; pm.sync_venv(['acp'], explicit=True)\"" >&2
  fi
fi

echo "==> Writing per-user config"
XDG_CONFIG_HOME=${XDG_CONFIG_HOME:-$HOME/.config}
CONFIG_DIR="$XDG_CONFIG_HOME/zed-hermes"
CONFIG_PATH="$CONFIG_DIR/config.json"
if [ ! -f "$CONFIG_PATH" ]; then
  mkdir -p "$CONFIG_DIR"
  cp "$ROOT/config/zed-hermes.example.json" "$CONFIG_PATH"
  echo "    $CONFIG_PATH"
else
  echo "    kept existing $CONFIG_PATH"
fi

if [ "$NO_ZED" -eq 1 ]; then
  echo "==> Zed settings snippet (--no-zed)"
  node "$ROOT/scripts/register-zed.mjs" --name "$NAME" --print
else
  echo "==> Registering the agent in Zed"
  if ! node "$ROOT/scripts/register-zed.mjs" --name "$NAME"; then
    echo "warning: could not update Zed settings automatically; paste the snippet printed above." >&2
  fi
fi

echo ""
echo "Done. Open the Agent Panel, start a new Hermes thread, and type \"/\"."
echo "Verify end-to-end with: npm run probe"
