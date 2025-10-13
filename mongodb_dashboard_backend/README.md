# MongoDB Dashboard Backend (Express)

Express.js backend serving REST APIs for the dashboard.

## Prerequisites
- Node.js >= 18 (< 21), npm >= 8

## Install
- npm install

## Environment
Copy .env.example to .env and set values as needed.

Variables:
- PORT: Port to listen on (default 3001)
- MONGODB_URI: MongoDB connection string
- MONGODB_DB: Optional database name override

Note: Do not commit the .env file.

## Run
- Development: npm run dev
- Production: npm start

Health endpoints:
- GET / -> { ok: true }
- GET /api/users, /api/session-tracking, /api/app-deployments -> placeholder data

## Notes
During preview environments, database connectivity is optional. If MONGODB_URI is not set, the server will start without a DB connection (routes return empty lists).
