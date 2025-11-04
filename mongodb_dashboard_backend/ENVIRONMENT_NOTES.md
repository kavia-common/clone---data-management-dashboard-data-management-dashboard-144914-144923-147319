# Backend Environment Configuration

Set required environment variables in a `.env` file at the backend root.

Required:
- PORT=3001               # default is 3001 if unset
- HOST=0.0.0.0            # default is 0.0.0.0 if unset
- MONGODB_URI=<your-mongodb-uri>   # required to enable DB-backed features

Optional:
- MONGODB_DB=<db-name>            # override database name (otherwise taken from URI)
- MONGOOSE_AUTO_INDEX=false       # 'true' to enable autoIndex
- NODE_ENV=development            # environment mode
- SWAGGER_TITLE=Dashboard API
- SWAGGER_VERSION=1.0.0
- SWAGGER_DESCRIPTION=REST API for Data Management Dashboard with MongoDB and Express
- SWAGGER_SERVER_URL=<public-url> # overrides auto computed server url in docs

Behavior when MONGODB_URI is missing:
- Server will still start and bind to the configured PORT.
- /health and /api/health will report db status as disconnected or connecting with a helpful hint.
