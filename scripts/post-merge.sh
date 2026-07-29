#!/bin/bash
set -e

echo "[post-merge] Installing dependencies..."
npm install --legacy-peer-deps

echo "[post-merge] Building frontend..."
npm run build

echo "[post-merge] Done."
