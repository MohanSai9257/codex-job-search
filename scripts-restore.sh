#!/bin/sh
set -eu
if [ "$#" -ne 1 ]; then echo 'Usage: ./scripts-restore.sh BACKUP.sqlite'; exit 1; fi
if [ ! -f "$1" ]; then echo 'Backup not found'; exit 1; fi
mkdir -p data
cp data/jobs.sqlite "data/jobs.before-restore-$(date +%Y%m%d-%H%M%S).sqlite" 2>/dev/null || true
cp "$1" data/jobs.sqlite
node server/cli.js STATUS
