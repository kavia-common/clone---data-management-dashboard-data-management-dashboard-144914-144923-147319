# Users API quick test guide

Base URL: http://localhost:${PORT:-3001}

Ensure you have MONGODB_URI configured in .env and the server running: `npm run dev`.

1) List users
curl -sS 'http://localhost:3001/api/users' | jq .

With pagination envelope:
curl -sS 'http://localhost:3001/api/users?page=1&limit=10&sort=-created_at' | jq .

With filter:
curl -sS 'http://localhost:3001/api/users?filter={"email":"user@example.com"}' | jq .

2) Seed demo users if collection empty
curl -sS 'http://localhost:3001/api/users/seed-if-empty' | jq .

3) Create user
curl -sS -X POST 'http://localhost:3001/api/users' \
  -H 'Content-Type: application/json' \
  -d '{"email":"new.user@example.com","name":"New User","organization_id":"org_demo"}' | jq .

4) Get by id
curl -sS 'http://localhost:3001/api/users/<_id>' | jq .

5) Update user
curl -sS -X PUT 'http://localhost:3001/api/users/<_id>' \
  -H 'Content-Type: application/json' \
  -d '{"department":"Engineering"}' | jq .

6) Delete user
curl -sS -X DELETE 'http://localhost:3001/api/users/<_id>' | jq .
