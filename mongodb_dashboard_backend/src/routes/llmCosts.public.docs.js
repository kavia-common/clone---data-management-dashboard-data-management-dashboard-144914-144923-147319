/**
 * @swagger
 * /api/llm-costs:
 *   get:
 *     summary: List all LLM cost records
 *     description: >
 *       Returns all documents from the llm_costs collection without requiring any filters.
 *       If explicit pagination (page/limit) is provided, response is wrapped with { success, data, meta }.
 *       Otherwise a raw array is returned. All fields present in the database are returned (no projection).
 *     tags: [LLMCosts]
 *     parameters:
 *       - in: query
 *         name: page
 *         schema: { type: integer, minimum: 1 }
 *         description: Optional page number to enable envelope response
 *       - in: query
 *         name: limit
 *         schema: { type: integer, minimum: 1, maximum: 200 }
 *         description: Optional page size to enable envelope response
 *       - in: query
 *         name: sort
 *         schema: { type: string }
 *         description: Optional sort string (e.g., -timestamp or total_cost)
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
 *       500:
 *         description: Internal server error
 */

/**
 * @swagger
 * /api/projects/{projectId}/llm-costs:
 *   get:
 *     summary: List LLM cost records (deprecated project alias)
 *     deprecated: true
 *     description: >
 *       Deprecated alias that forwards to /api/llm-costs (list-all). This path no longer applies project-based filtering.
 *     tags: [LLMCosts]
 *     parameters:
 *       - in: path
 *         name: projectId
 *         required: true
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
 */
