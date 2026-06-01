#!/bin/bash
# GaussianHelper Local Server for Linux
# Bypasses browser CORS restrictions on file:// paths

PORT=8080
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

# Detect Python
if command -v python3 >/dev/null 2>&1; then
    CMD="python3 -m http.server $PORT"
elif command -v python >/dev/null 2>&1; then
    CMD="python -m SimpleHTTPServer $PORT"
else
    echo "Error: Python is required to run the local server but was not found."
    echo "Please install python or run an HTTP server manually."
    exit 1
fi

echo "Starting GaussianHelper server on http://localhost:$PORT ..."

# Start the HTTP server in the background
$CMD >/dev/null 2>&1 &
SERVER_PID=$!

# Trap exits to kill the server when script terminates
trap "kill $SERVER_PID 2>/dev/null" EXIT

# Give the server a moment to bind to the port
sleep 0.5

# Open default browser
if command -v xdg-open >/dev/null 2>&1; then
    xdg-open "http://localhost:$PORT" >/dev/null 2>&1
elif command -v sensible-browser >/dev/null 2>&1; then
    sensible-browser "http://localhost:$PORT" >/dev/null 2>&1
fi

echo "Server running (PID $SERVER_PID). Press Ctrl+C to stop."
wait
