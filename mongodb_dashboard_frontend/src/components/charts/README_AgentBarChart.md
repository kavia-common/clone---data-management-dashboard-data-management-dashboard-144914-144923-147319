# AgentBarChart

Purpose: Visualize activity grouped by agent name as a bar chart.

- Data source: GET /api/llm-costs (client-side aggregation)
- Metrics:
  - Count: number of records per agent
  - Total cost: sum of `total_cost` per agent
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
