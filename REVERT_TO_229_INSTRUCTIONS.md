# Revert Repository to Version 229 (Backend and Frontend)

This repository needs to be reverted to version "229" across all containers and discard any subsequent changes. Follow these non-interactive steps.

Important:
- Ensure you run these commands from the repository root that contains both container workspaces.
- Use non-interactive commands only (as shown).
- If you do not have the "229" tag/commit, stop and obtain the correct commit/tag ID corresponding to "229".

## 1) Verify git status and current branch
```bash
git status
git rev-parse --abbrev-ref HEAD
```

## 2) Fetch all tags and commits (in case "229" is remote)
```bash
git fetch --all --tags --prune
```

## 3) Confirm the existence of version "229"
Try in order:
```bash
git rev-parse 229 2>/dev/null || true
git show-ref --tags | grep -E 'refs/tags/(^|/)229$' || true
git log --oneline --decorate --all | grep -E '(^| )229( |$)' || true
```
- If any of these return a commit hash or a tag for "229", proceed.
- If not found, STOP and provide the correct commit/tag that represents version 229.

## 4) Create a safety branch with the current state (optional but recommended)
```bash
git checkout -b backup-before-revert-229-$(date +%Y%m%d-%H%M%S)
```

## 5) Reset the repository to "229"
Use the exact ref (tag or commit SHA) for 229. The following will hard reset the entire repo:
```bash
git reset --hard 229
git clean -fdx
```

Notes:
- The repository contains two containers:
  - Backend: data-management-dashboard-144914-144923/mongodb_dashboard_backend
  - Frontend: data-management-dashboard-144914-144924/mongodb_dashboard_frontend
- A single hard reset at the repo root will revert both containers consistently.

## 6) Verify reverted files
```bash
git status
git log --oneline -n 3
```

## 7) Install dependencies if required by version 229
Backend (Express):
```bash
cd data-management-dashboard-144914-144923/mongodb_dashboard_backend
npm ci || npm install --no-audit --no-fund
```

Frontend (React):
```bash
cd ../../data-management-dashboard-144914-144924/mongodb_dashboard_frontend
npm ci || npm install --no-audit --no-fund
```

## 8) Run local checks (optional)
Backend:
```bash
cd data-management-dashboard-144914-144923/mongodb_dashboard_backend
npm run build 2>/dev/null || true
npm run start 2>/dev/null || true
```

Frontend:
```bash
cd ../../data-management-dashboard-144914-144924/mongodb_dashboard_frontend
npm run build 2>/dev/null || true
npm start 2>/dev/null || true
```

## 9) Summary of the revert (to update after execution)
- Target version: 229
- Method: git reset --hard 229 at repo root
- Containers reverted: 
  - mongodb_dashboard_backend
  - mongodb_dashboard_frontend
- Post-revert dependency installs: backend/frontend npm ci (or npm install)
- Files unable to restore: N/A (entire repo reset)
- Environment variables: No changes required

If you have a project-specific snapshot mechanism (not git):
- Replace step 5 with copying the snapshot “229” contents over the working tree for both containers, then re-install dependencies as shown above.

