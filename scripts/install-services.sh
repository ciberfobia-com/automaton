#!/usr/bin/env bash
#
# install-services.sh — Auto-install systemd units for CiberPadre
#
# Usage (run from repo root):
#   sudo bash scripts/install-services.sh
#
# This script:
#   1. Copies .service files to /etc/systemd/system/
#   2. Reloads systemd daemon
#   3. Enables services for auto-start on boot
#   4. Does NOT start services (you do that manually)
#
# Safe to re-run after git pull — it overwrites the unit files.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(dirname "$SCRIPT_DIR")"

# Check root
if [[ $EUID -ne 0 ]]; then
    echo "ERROR: Run with sudo: sudo bash $0"
    exit 1
fi

echo "=== CiberPadre Service Installer ==="
echo "Repo:    $REPO_DIR"
echo ""

# Copy service files
for svc in ciberpadre.service ciberpadre-dashboard.service; do
    src="$SCRIPT_DIR/$svc"
    dst="/etc/systemd/system/$svc"
    if [[ ! -f "$src" ]]; then
        echo "WARN: $src not found, skipping"
        continue
    fi
    cp "$src" "$dst"
    echo "✓ Installed $dst"
done

# Reload systemd
systemctl daemon-reload
echo "✓ systemd daemon reloaded"

# Enable services (auto-start on boot)
systemctl enable ciberpadre 2>/dev/null || true
systemctl enable ciberpadre-dashboard 2>/dev/null || true
echo "✓ Services enabled for auto-start"

echo ""
echo "=== Done ==="
echo ""
echo "Commands:"
echo "  sudo systemctl start ciberpadre                # Start runtime"
echo "  sudo systemctl start ciberpadre-dashboard      # Start dashboard"
echo "  sudo systemctl status ciberpadre               # Check status"
echo "  sudo journalctl -u ciberpadre -f               # View logs"
echo ""
echo "If services are already running, restart them:"
echo "  sudo systemctl restart ciberpadre ciberpadre-dashboard"
