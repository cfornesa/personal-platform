#!/bin/bash
set -e

# Install workspace dependencies after a task merge.
npm ci

# Schema sync intentionally NOT run here.
#
# The API server applies schema migrations at startup via
# ensureTables() + ensureColumn() in artifacts/api-server/src/lib/db,
# which is the single source of truth for schema reconciliation in this
# project. The API server restarts immediately after every task merge,
# so any schema change ships at that moment.
#
# `drizzle-kit push` was previously invoked here as a safety net but
# repeatedly hung on the shared Hostinger MySQL host's schema-pull step
# (it introspects every table on the database, including neighboring
# tenants), causing post-merge timeouts that blocked merges without
# catching anything the runtime path doesn't already handle.
#
# If you need an explicit one-shot push (e.g. before a deploy that
# bypasses the API server startup path), run:
#   npm run push-force --workspace=@workspace/db
