# MongoDB Connection Environment Notes

Set the following environment variables for correct DB selection and for /api/llm-costs to read from the proper collection:

- MONGODB_URI: Full MongoDB connection string (do not include dbName unless you want to hard-bind it).
- MONGODB_DB: Database name that contains the 'llm_costs' collection.

Example .env.example:
MONGODB_URI=mongodb+srv://<user>:<pass>@<cluster-host>/?retryWrites=true&w=majority
MONGODB_DB=your_database_name

Verification steps:
1. Start the backend and check logs:
   - Look for "[Startup] Initializing DB connection..." and "[DB Diagnostics] Resolved dbName=...; Model collection bindings: LlmCost -> llm_costs".
2. Ensure your MongoDB database actually has documents in the 'llm_costs' collection.
3. Call:
   - GET /api/llm-costs
   - GET /api/llm-costs?page=1&limit=10
   Expect non-empty results when data exists.
