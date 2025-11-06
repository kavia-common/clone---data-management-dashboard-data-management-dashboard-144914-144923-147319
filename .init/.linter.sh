#!/bin/bash
cd /home/kavia/workspace/code-generation/data-management-dashboard-144914-144924/mongodb_dashboard_frontend
npm run build
EXIT_CODE=$?
if [ $EXIT_CODE -ne 0 ]; then
   exit 1
fi

