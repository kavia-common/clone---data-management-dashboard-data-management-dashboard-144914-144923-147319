const express = require('express');

const router = express.Router();
// Note: This router is mounted at /api/auth in app.js, so POST /api/auth/login is the effective path.

/**
 * @swagger
 * /api/auth/login:
 *   post:
 *     summary: Login
 *     description: Authenticate a user by organization, email and password. Returns placeholder values in this stub implementation.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               organization_id:
 *                 type: string
 *               email:
 *                 type: string
 *               password:
 *                 type: string
 *             required: [organization_id, email, password]
 *           example:
 *             organization_id: org_123
 *             email: user@example.com
 *             password: secret
 *     responses:
 *       200:
 *         description: OK
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 *             example: "string"
 *       404:
 *         description: Not found
 *         content:
 *           application/json:
 *             schema:
 *               type: string
 *             example: "string"
 *       422:
 *         description: Validation Error
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 detail:
 *                   type: array
 *                   items:
 *                     type: object
 *                     properties:
 *                       loc:
 *                         type: array
 *                         items:
 *                           oneOf:
 *                             - type: string
 *                             - type: number
 *                       msg:
 *                         type: string
 *                       type:
 *                         type: string
 *                     required: [loc, msg, type]
 *               required: [detail]
 *             example:
 *               detail:
 *                 - loc: ["body", "organization_id"]
 *                   msg: "field required"
 *                   type: "value_error"
 */

/*
PUBLIC_INTERFACE
Route: POST /auth/login
Minimal placeholder login endpoint with validation.
- Accepts JSON body only: { organization_id: string, email: string, password: string }
- Returns:
  - 422 for validation errors with { detail: [ { loc: ['body', '<field>'], msg: '<message>', type: 'value_error' } ] }
  - 404 if "user not found" simulated condition triggers
  - 200 with a JSON string (placeholder token or 'ok')
*/
router.post('/login', (req, res) => {
  // Ensure content-type JSON body parsing has been applied upstream (app.js uses express.json()).
  const { organization_id, email, password } = req.body || {};

  const errors = [];

  // Validate presence and type of required fields
  const validateStringField = (value, fieldName) => {
    if (value === undefined || value === null) {
      errors.push({
        loc: ['body', fieldName],
        msg: 'field required',
        type: 'value_error',
      });
    } else if (typeof value !== 'string') {
      errors.push({
        loc: ['body', fieldName],
        msg: 'must be a string',
        type: 'value_error',
      });
    } else if (value.trim() === '') {
      errors.push({
        loc: ['body', fieldName],
        msg: 'must not be empty',
        type: 'value_error',
      });
    }
  };

  validateStringField(organization_id, 'organization_id');
  validateStringField(email, 'email');
  validateStringField(password, 'password');

  if (errors.length > 0) {
    return res.status(422).json({ detail: errors });
  }

  // Simulate user not found condition: if organization_id === 'notfound' OR email not including '@'
  if (organization_id === 'notfound' || !String(email).includes('@')) {
    return res.status(404).json('not found');
  }

  // Placeholder success (no real auth yet)
  return res.status(200).json('ok');
});

module.exports = router;
