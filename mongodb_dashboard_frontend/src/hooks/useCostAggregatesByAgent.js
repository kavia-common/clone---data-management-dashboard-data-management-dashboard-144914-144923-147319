 /**
  * PUBLIC_INTERFACE
  * useCostAggregatesByAgent (JS)
  * Returns aggregated cost records for grouped-by-agent visualization.
  * If a backend aggregate API is not available, returns a mock dataset for development.
  *
  * Parameters:
  * - options?: { tenantId?: string; from?: string; to?: string }
  * - groupBy?: "environment" | "cost_category"
  *
  * Returns:
  * - { data: Array<{ agent_name: string; environment?: string; cost_category?: string; total_cost: number }>, loading: boolean, error?: string }
  */
 import { useEffect, useMemo, useState } from "react";
 
 export default function useCostAggregatesByAgent(options, groupBy = "environment") {
   const [data, setData] = useState([]);
   const [loading, setLoading] = useState(true);
   const [error, setError] = useState("");
 
   const mock = useMemo(
     () => [
       { agent_name: "Agent Alpha", environment: "prod", cost_category: "compute", total_cost: 3.4 },
       { agent_name: "Agent Alpha", environment: "staging", cost_category: "compute", total_cost: 1.1 },
       { agent_name: "Agent Beta", environment: "prod", cost_category: "storage", total_cost: 2.2 },
       { agent_name: "Agent Beta", environment: "dev", cost_category: "egress", total_cost: 0.4 },
       { agent_name: "Agent Gamma", environment: "prod", cost_category: "compute", total_cost: 1.2 },
     ],
     []
   );
 
   useEffect(() => {
     let cancelled = false;
     async function load() {
       setLoading(true);
       setError("");
       try {
         // TODO: Replace with backend aggregate endpoint when available.
         // Suggested API Example:
         // GET /api/llm-costs/aggregates?dimensions=agent_name,${groupBy}&metrics=SUM(total_cost)
         await new Promise((r) => setTimeout(r, 150)); // simulate latency
         if (!cancelled) {
           // For now, serve mock.
           setData(mock);
         }
       } catch (e) {
         if (!cancelled) {
           setError(e?.message || "Failed to load cost aggregates by agent.");
           setData([]);
         }
       } finally {
         if (!cancelled) setLoading(false);
       }
     }
     load();
     return () => {
       cancelled = true;
     };
     // options can include tenant/time filters; fetch is mocked anyway
   }, [options, groupBy, mock]);
 
   return { data, loading, error };
 }
