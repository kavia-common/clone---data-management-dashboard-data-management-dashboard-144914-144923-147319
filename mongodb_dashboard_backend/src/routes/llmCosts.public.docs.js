/**
 * @swagger
 * /api/llm-costs:
 *   get:
 *     summary: List LLM cost records
 *     description: >
 *       Returns a list of LLM cost documents. Supports optional projectId filter and date range.
 *       If explicit pagination (page/limit) is provided, response is wrapped with { success, data, meta }.
 *       Otherwise a raw array is returned.
 *     tags: [LLMCosts]
 *     parameters:
 *       - in: query
 *         name: projectId
 *         schema: { type: string }
 *         description: Optional project identifier to filter costs (maps to project_id)
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *         description: Optional ISO date-time lower bound (applied to timestamp)
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *         description: Optional ISO date-time upper bound (applied to timestamp)
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200 }
 *       - in: query
 *         name: sort
 *         schema: { type: string }
 *         description: Sort string (e.g., -timestamp or total_cost)
 *       - in: query
 *         name: filter
 *         schema: { type: string }
 *         description: Additional JSON filter (merged with projectId/date filters)
 *     responses:
 *       200:
 *         description: Successful response (array or envelope based on pagination params)
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - type: array
 *                   items: { $ref: '#/components/schemas/GenericDocument' }
 *                 - $ref: '#/components/schemas/ListEnvelope'
 *       400:
 *         description: Invalid filter or date
 *       500:
 *         description: Internal server error
 */

/**
 * @swagger
 * /api/projects/{projectId}/llm-costs:
 *   get:
 *     summary: List LLM cost records for a project
 *     description: Returns LLM cost documents filtered by projectId. Supports optional from/to date range and pagination.
 *     tags: [LLMCosts]
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: from
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: to
 *         schema: { type: string, format: date-time }
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1 }
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200 }
 *       - in: query
 *         name: sort
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Successful response (array or envelope based on pagination params)
 *         content:
 *           application/json:
 *             schema:
 *               oneOf:
 *                 - type: array
 *                   items: { $ref: '#/components/schemas/GenericDocument' }
 *                 - $ref: '#/components/schemas/ListEnvelope'
 *       400: { description: Invalid input }
 *       500: { description: Internal server error }
 */
