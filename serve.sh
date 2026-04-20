#!/usr/bin/env bash
# Quick local server for ODTAULAI PWA
# Usage: ./serve.sh [port]
# Default port: 8080

PORT="${1:-8080}"
cd "$(dirname "$0")"

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo " ODTAULAI — Local Dev Server"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "  Open in browser:"
echo "    http://localhost:$PORT"
echo ""
echo "  Open on your phone (same Wi-Fi):"
LAN_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || ipconfig getifaddr en0 2>/dev/null)
if [ -n "$LAN_IP" ]; then
  echo "    http://$LAN_IP:$PORT"
else
  echo "    http://<your-lan-ip>:$PORT"
fi
echo ""
echo "  Press Ctrl+C to stop"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

if command -v python3 >/dev/null 2>&1; then
  python3 -m http.server "$PORT"
elif command -v python >/dev/null 2>&1; then
  python -m SimpleHTTPServer "$PORT"
elif command -v npx >/dev/null 2>&1; then
  npx --yes serve -l "$PORT" .
else
  echo "ERROR: Need python3, python, or npx to serve files."
  echo "Install one of: Python 3 (https://python.org) or Node.js (https://nodejs.org)"
  exit 1
fi
