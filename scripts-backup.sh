#!/bin/sh
set -eu
mkdir -p backups
node -e "import('./server/db.js').then(({db})=>db.backup(process.argv[1]))" "backups/jobs-$(date +%Y%m%d-%H%M%S).sqlite"
