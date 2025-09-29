#!/bin/bash
cd /home/kavia/workspace/code-generation/data-management-dashboard-144914-144923/mongodb_dashboard_backend
npm run lint
LINT_EXIT_CODE=$?
if [ $LINT_EXIT_CODE -ne 0 ]; then
  exit 1
fi

