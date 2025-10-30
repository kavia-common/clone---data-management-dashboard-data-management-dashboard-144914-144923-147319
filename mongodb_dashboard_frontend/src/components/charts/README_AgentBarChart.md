# AgentBarChart

Purpose: Visualize activity grouped by agent name as a bar chart.

- Default data source: GET /api/llm-costs (client-side aggregation)
  - Robust agent normalization: agent is resolved from the first non-empty of:
    `agent_name` | `agent` | `tool` | `metadata.agent_name` | `service_type`
  - Numeric parsing: total cost is parsed from `total_cost` (or fallback `total`, `value`, `amount`) and accepts numbers or strings like "$0.01" or "1,234.56".
- Optional preferred data source: GET /api/costs/by-agent (if backend provides it) via a client helper (not required). When used, map items -> bars accordingly.
- Metrics:
  - Count: number of records per agent
  - Total cost: sum of parsed totals per agent
- Controls:
  - Metric selector: Count | Total cost
  - Top N: limits number of displayed agents (1..50)

Usage example (page):
```jsx
import AgentBarChart from "../../components/charts/AgentBarChart.jsx";
<AgentBarChart defaultMetric="count" defaultTopN={10} height={360} />;
```

Accessibility:
- Region and control labels added.
- Loading, error and empty states included.

Styling: Uses Ocean Professional theme and chart color tokens.
