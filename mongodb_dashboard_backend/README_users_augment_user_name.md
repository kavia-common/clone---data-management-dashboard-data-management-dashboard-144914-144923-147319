# USERS user_name resolution behavior

- When calling list endpoints that reference user_id (e.g., LLM costs, sessions), you may pass either:
  - ?userId=<MongoId> OR
  - ?user_name=<MongoId>
- The backend validates the id (400 when invalid), looks up the user by _id, and:
  - For /api/users: filters by _id and returns that user document with normalized `name`.
  - For other collections: filters by user_id=<id> and augments each row with:
    - user_name: <users.name>
    - user: { name: <users.name> } (for table mappers expecting nested user.name)

Client guidance:
- Display column can be bound to either `user_name` or `user.name`.
- When filtering by a selected user, send `?userId=<id>` (preferred) or `?user_name=<id>` for compatibility.

Pagination and safety:
- Pagination enforcement remains unchanged.
- Invalid ObjectId in these params returns 400.
