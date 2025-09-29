const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

/**
 * Hash a plaintext password with configured salt rounds.
 */
async function hashPassword(plain) {
  const rounds = parseInt(process.env.PASSWORD_SALT_ROUNDS || '12', 10);
  const salt = await bcrypt.genSalt(rounds);
  return bcrypt.hash(plain, salt);
}

/**
 * Compare a plaintext password against a hash.
 */
function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

/**
 * Generate a signed JWT for a user payload.
 */
function signToken(payload) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  const expiresIn = process.env.JWT_EXPIRES_IN || '1d';
  return jwt.sign(payload, secret, { expiresIn });
}

/**
 * Verify a JWT token string and return payload if valid.
 */
function verifyToken(token) {
  const secret = process.env.JWT_SECRET;
  if (!secret) throw new Error('JWT_SECRET is not set');
  return jwt.verify(token, secret);
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken };
