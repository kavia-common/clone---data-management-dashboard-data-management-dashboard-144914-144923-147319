 /**
  * PUBLIC_INTERFACE
  * Versioned authentication hashing utility with per-organization salt support.
  *
  * - v1: Legacy static salt from environment (SECRET_SALT / AUTH_TENANT_SALT fallback) using Node.js scrypt.
  *       This is provided for backward compatibility to verify existing password hashes, if any.
  * - v2: Preferred: per-organization Tenant.orgSalt + optional global PEPPER (AUTH_PASSWORD_PEPPER or AUTH_PEPPER).
  *       Uses Argon2id when available; falls back to bcrypt; if neither available, uses Node.js scrypt.
  *
  * Notes:
  * - We DO NOT expose any salts or secrets in logs.
  * - Hash inputs use: password + '|' + orgSalt + (pepper || '') to ensure org-level isolation.
  * - For bcrypt/argon2 we include orgSalt+pepper in the password input (not salt parameter) to keep a single code path.
  */

 const crypto = require('crypto');
 const { getTenantSaltConfig } = require('../config/auth');

 // Attempt to load argon2/bcrypt optionally without breaking if not installed
 let argon2 = null;
 let bcrypt = null;
 try { argon2 = require('argon2'); } catch (_err) { argon2 = null; }
 try { bcrypt = require('bcrypt'); } catch (_err) { bcrypt = null; }

 /**
  * PUBLIC_INTERFACE
  * Get optional global pepper from environment.
  * @returns {string}
  */
 function getPepper() {
   const v = (process.env.AUTH_PASSWORD_PEPPER || process.env.AUTH_PEPPER || '').trim();
   return v || '';
 }

 /**
  * Build the canonical input used for hashing/verification for a given version.
  * For v2 we require tenant.orgSalt. For v1 we use the legacy static salt from config.
  * @param {{ password: string, version: 1|2, tenant?: { orgSalt?: string } }} params
  * @returns {string}
  */
 function buildHashInput({ password, version, tenant }) {
   const pepper = getPepper();
   if (version === 2) {
     const orgSalt = tenant?.orgSalt;
     if (!orgSalt || typeof orgSalt !== 'string' || orgSalt.trim() === '') {
       throw new Error('Tenant orgSalt is missing');
     }
     return `${password}|${orgSalt}|${pepper}`;
   }
   // v1 legacy: use static salt from config (url-safe-ish, we only need a secret string)
   const { salt, isMissing } = getTenantSaltConfig();
   if (isMissing) {
     // Still return password-only to avoid throwing, but warn via console for maintainers.
      
     console.warn('[authHash] Legacy static salt missing; v1 hashes may not verify as expected.');
   }
   return `${password}|${salt || ''}|${pepper}`;
 }

 /**
  * PUBLIC_INTERFACE
  * Hash password using v2 scheme (preferred). Automatically picks the strongest available algorithm.
  * @param {string} password
  * @param {object} tenant - Mongoose tenant doc or POJO with orgSalt
  * @returns {Promise<{ hash: string, algo: 'argon2id'|'bcrypt'|'scrypt', version: number }>}
  */
 async function hashPasswordV2(password, tenant) {
   const input = buildHashInput({ password, version: 2, tenant });

   // Prefer Argon2id if available
   if (argon2 && typeof argon2.hash === 'function') {
     const hash = await argon2.hash(input, { type: argon2.argon2id });
     return { hash, algo: 'argon2id', version: 2 };
   }

   // Else bcrypt
   if (bcrypt && typeof bcrypt.hash === 'function') {
     const rounds = Number.parseInt(process.env.BCRYPT_ROUNDS || '12', 10);
     const cost = Number.isFinite(rounds) && rounds >= 10 && rounds <= 14 ? rounds : 12;
     const hash = await bcrypt.hash(input, cost);
     return { hash, algo: 'bcrypt', version: 2 };
   }

   // Else fallback to Node scrypt with a stable random salt per hash
   const salt = crypto.randomBytes(16);
   const dk = crypto.scryptSync(input, salt, 64);
   const hash = `scrypt$${salt.toString('base64')}$${dk.toString('base64')}`;
   return { hash, algo: 'scrypt', version: 2 };
 }

 /**
  * PUBLIC_INTERFACE
  * Hash password using v1 (legacy static salt) with Node scrypt for compatibility baseline.
  * This is used for verifying existing hashes, not for new hashes.
  * @param {string} password
  * @returns {Promise<{ hash: string, algo: 'scrypt', version: number }>}
  */
 async function hashPasswordV1(password) {
   const input = buildHashInput({ password, version: 1 });
   const salt = crypto.randomBytes(16);
   const dk = crypto.scryptSync(input, salt, 64);
   const hash = `scrypt$${salt.toString('base64')}$${dk.toString('base64')}`;
   return { hash, algo: 'scrypt', version: 1 };
 }

 /**
  * PUBLIC_INTERFACE
  * Verify a password against a stored hash. Chooses verifier based on hash string and/or user.hashVersion.
  * If v1 (legacy) verifies successfully and a tenant is provided, returns { ok: true, needsMigration: true }.
  * @param {object} params
  * @param {string} params.password
  * @param {{ password_hash: string, hashVersion?: number }} params.user
  * @param {{ orgSalt?: string }} params.tenant
  * @returns {Promise<{ ok: boolean, needsMigration: boolean }>}
  */
 async function verifyPassword({ password, user, tenant }) {
   const stored = user?.password_hash || user?.hash || '';
   const version = Number.isFinite(user?.hashVersion) ? user.hashVersion : 1;
   if (!stored || typeof stored !== 'string') {return { ok: false, needsMigration: false };}

   // Determine algorithm by prefix for scrypt; argon2 and bcrypt expose their own formats
   const tryInputV1 = () => buildHashInput({ password, version: 1 });
   const tryInputV2 = () => buildHashInput({ password, version: 2, tenant });

   // Try current version first
   if (version === 2) {
     const input = tryInputV2();
     const ok = await compareHash(input, stored);
     if (ok) {return { ok: true, needsMigration: false };}
     // Also try legacy as fallback if tenant salt just got introduced
     const okLegacy = await compareHash(tryInputV1(), stored);
     if (okLegacy) {return { ok: true, needsMigration: true };}
     return { ok: false, needsMigration: false };
   }

   // version === 1
   const okLegacy = await compareHash(tryInputV1(), stored);
   if (okLegacy) {return { ok: true, needsMigration: Boolean(tenant && tenant.orgSalt) };}
   // If legacy fails but v2 would pass (rare), treat as needsMigration when tenant is available
   try {
     const okV2 = tenant ? await compareHash(tryInputV2(), stored) : false;
     if (okV2) {return { ok: true, needsMigration: false };}
   } catch {
     // ignore
   }
   return { ok: false, needsMigration: false };
 }

 /**
  * Compare a constructed input with a stored hash using the right algorithm parser.
  * @param {string} input
  * @param {string} stored
  * @returns {Promise<boolean>}
  */
 async function compareHash(input, stored) {
   // Argon2 encoded strings start with `$argon2`
   if (stored.startsWith('$argon2')) {
     if (!argon2 || typeof argon2.verify !== 'function') {return false;}
     try {
       return await argon2.verify(stored, input);
     } catch {
       return false;
     }
   }

   // bcrypt encoded strings start with `$2a$` or `$2b$` or `$2y$`
   if (stored.startsWith('$2a$') || stored.startsWith('$2b$') || stored.startsWith('$2y$')) {
     if (!bcrypt || typeof bcrypt.compare !== 'function') {return false;}
     try {
       return await bcrypt.compare(input, stored);
     } catch {
       return false;
     }
   }

   // scrypt fallback format: "scrypt$<base64-salt>$<base64-hash>"
   if (stored.startsWith('scrypt$')) {
     try {
       const parts = stored.split('$');
       const saltB64 = parts[1] || '';
       const hashB64 = parts[2] || '';
       const salt = Buffer.from(saltB64, 'base64');
       const dk = crypto.scryptSync(input, salt, 64);
       return crypto.timingSafeEqual(Buffer.from(hashB64, 'base64'), dk);
     } catch {
       return false;
     }
   }

   // Unknown format
   return false;
 }

 /**
  * PUBLIC_INTERFACE
  * Ensure tenant has an orgSalt; if missing, generate one and persist.
  * Non-throwing; returns sanitized { ok, updated } without exposing the salt.
  * @param {{ orgSalt?: string, orgSaltVersion?: number, tenant_id?: string, save?: Function }} tenantDoc
  * @returns {Promise<{ ok: boolean, updated: boolean }>}
  */
 async function ensureTenantOrgSalt(tenantDoc) {
   try {
     if (!tenantDoc) {return { ok: false, updated: false };}
     if (!tenantDoc.orgSalt || typeof tenantDoc.orgSalt !== 'string' || tenantDoc.orgSalt.trim() === '') {
       tenantDoc.orgSalt = crypto.randomBytes(32).toString('base64');
       tenantDoc.orgSaltVersion = tenantDoc.orgSaltVersion || 1;
       await tenantDoc.save();
        
       console.info('[authHash] Generated missing orgSalt for tenant', { tenant_id: tenantDoc.tenant_id });
       return { ok: true, updated: true };
     }
     return { ok: true, updated: false };
   } catch (e) {
      
     console.error('[authHash] Failed to ensure tenant orgSalt', { message: e?.message });
     return { ok: false, updated: false };
   }
 }

 /**
  * PUBLIC_INTERFACE
  * Hash password with version selection. Defaults to v2 (tenant orgSalt + optional global pepper).
  * For v1, uses legacy static salt fallback.
  * @param {{ password: string, tenant?: { orgSalt?: string }, version?: 1|2 }} params
  * @returns {Promise<{ hash: string, version: number, algo: string }>}
  */
 async function hashPassword({ password, tenant, version = 2 }) {
   if (version === 2) {
     return hashPasswordV2(password, tenant);
   }
   return hashPasswordV1(password);
 }

 /**
  * PUBLIC_INTERFACE
  * Verify a candidate password and, when applicable, provide new hash/version for migration.
  * - If verification fails: { valid: false, migrated: false }
  * - If verification succeeds on legacy (v1) and tenant provided: { valid: true, migrated: true, newHash, newVersion: 2 }
  * - If verification succeeds on current (v2): { valid: true, migrated: false }
  * @param {{ candidate: string, user: { password_hash: string, hashVersion?: number, _id?: any }, tenant?: { orgSalt?: string } }} params
  * @returns {Promise<{ valid: boolean, migrated: boolean, newHash?: string, newVersion?: number }>}
  */
 async function verifyAndMigrate({ candidate, user, tenant }) {
   const { ok, needsMigration } = await verifyPassword({ password: candidate, user, tenant });
   if (!ok) {return { valid: false, migrated: false };}
   if (needsMigration) {
     const { hash, version } = await hashPasswordV2(candidate, tenant);
     return { valid: true, migrated: true, newHash: hash, newVersion: version };
   }
   return { valid: true, migrated: false };
 }

/**
 * PUBLIC_INTERFACE
 * Export named helpers for authentication hashing utilities.
 */
const authHash = {
  getPepper,
  hashPasswordV1,
  hashPasswordV2,
  verifyPassword,
  ensureTenantOrgSalt,
  hashPassword,
  verifyAndMigrate,
};

module.exports = {
  getPepper,
  hashPasswordV1,
  hashPasswordV2,
  verifyPassword,
  ensureTenantOrgSalt,
  hashPassword,
  verifyAndMigrate,
  authHash,
};
