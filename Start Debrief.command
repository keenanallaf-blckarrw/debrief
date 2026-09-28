#!/bin/bash
# Double-click this file to start Debrief. It opens Debrief in your browser.
# Leave this window open while you trade; close it (or press Control + C) to stop.

cd "$(dirname "$0")" || exit 1

if ! command -v npm >/dev/null 2>&1; then
  echo ""
  echo "  Node.js isn't installed yet."
  echo "  Download the LTS version from https://nodejs.org, install it, then double-click this file again."
  echo ""
  read -n 1 -s -r -p "  Press any key to close this window."
  exit 1
fi

if [ ! -d node_modules ]; then
  echo ""
  echo "  First run: installing Debrief's building blocks (about a minute)..."
  echo ""
  if ! npm install; then
    read -n 1 -s -r -p "  The install didn't finish. Check your internet connection, then press any key to close."
    exit 1
  fi
fi

npm start
