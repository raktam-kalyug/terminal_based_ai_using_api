#!/usr/bin/env bash
# Quick starter script for LAN Fox Chat
set -e

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

echo "🦊 Checking environment..."

if ! command -v node >/dev/null 2>&1; then
  echo "Error: Node.js 20 or newer is required but not found."
  echo "Please install Node.js from https://nodejs.org"
  exit 1
fi

NODE_MAJOR=$(node -v | cut -d'.' -f1 | sed 's/v//')
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Warning: Node.js version $NODE_MAJOR detected. Node.js 20+ is recommended."
fi

# Run setup wizard
node setup.js
