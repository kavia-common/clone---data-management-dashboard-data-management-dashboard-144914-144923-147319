# Suggested Indexes for Feature Usage Analytics

To optimize the feature usage aggregation:

```
db.session_tracking.createIndex({ service_type: 1, last_updated: 1 });
db.session_tracking.createIndex({ service_type: 1, session_start: 1 });
db.session_tracking.createIndex({ "session_data.feature": 1 });
db.session_tracking.createIndex({ feature_name: 1 });
db.session_tracking.createIndex({ action: 1 });
```

Notes:
- The query prefers `last_updated` falling back to `session_start`. Having indexes on both time fields helps.
- Feature name may live in `session_data.feature`, `feature_name`, or `action` based on upstream writers.
