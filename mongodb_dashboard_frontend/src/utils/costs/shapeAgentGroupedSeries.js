 /**
  * PUBLIC_INTERFACE
  * shapeAgentGroupedSeries (JS)
  * Shapes raw aggregate records into a Recharts-friendly grouped dataset by agent_name,
  * with zero-filled categories across all agents to ensure consistent bar groups.
  *
  * Input records should contain:
  * - agent_name: string
  * - environment?: string
  * - cost_category?: string
  * - total_cost: number
  *
  * @param {Array<{agent_name:string, environment?:string, cost_category?:string, total_cost:number}>} records
  * @param {"environment"|"cost_category"} groupBy Secondary dimension used for per-agent grouping
  * @param {{ unknownLabel?: string, agentLabel?: string, sortAgents?: boolean, sortCategories?: boolean }} [options]
  * @returns {{ data: Array<object>, categories: string[], agents: string[] }}
  */
 export function shapeAgentGroupedSeries(records, groupBy = "environment", options) {
   if (!Array.isArray(records)) {
     throw new Error("shapeAgentGroupedSeries: records must be an array");
   }
   const unknownLabel = (options && options.unknownLabel) || "Uncategorized";
   const agentKey = (options && options.agentLabel) || "agent_name";
   const sortAgents = options?.sortAgents ?? true;
   const sortCategories = options?.sortCategories ?? true;

   const agentsSet = new Set();
   const categoriesSet = new Set();
   const nested = {}; // agent -> category -> sum

   const readCategory = (r) => {
     const v = r && r[groupBy];
     const label = v == null || v === "" ? unknownLabel : String(v);
     return label;
   };

   records.forEach((row) => {
     const agent = row?.agent_name ? String(row.agent_name) : "Unknown";
     const cat = readCategory(row);
     const value = Number(row?.total_cost ?? 0);

     agentsSet.add(agent);
     categoriesSet.add(cat);
     if (!nested[agent]) nested[agent] = {};
     nested[agent][cat] = (nested[agent][cat] ?? 0) + (Number.isFinite(value) ? value : 0);
   });

   const agents = Array.from(agentsSet);
   const categories = Array.from(categoriesSet);

   if (sortAgents) agents.sort((a, b) => a.localeCompare(b));
   if (sortCategories) categories.sort((a, b) => a.localeCompare(b));

   const data = agents.map((agent) => {
     const row = { [agentKey]: agent };
     categories.forEach((cat) => {
       row[cat] = Number(nested[agent]?.[cat] ?? 0);
     });
     return row;
   });

   return { data, categories, agents };
 }
