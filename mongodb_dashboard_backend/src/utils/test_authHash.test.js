'use strict';

/**
 * Unit tests for authentication hashing utilities:
 * - v2 hashing uses tenant.orgSalt + optional pepper
 * - verifyAndMigrate behavior for v2 and legacy v1
 * - ensureTenantOrgSalt auto-generation and persistence (mocked)
 * - Error handling when tenant.orgSalt is missing for v2
 */

const {
  getPepper,
  hashPasswordV1,
  hashPasswordV2,
  verifyPassword,
  ensureTenantOrgSalt,
  hashPassword,
  verifyAndMigrate,
} = require('./authHash');

describe('authHash utility', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    // Reset env to a known baseline before each test
    process.env.AUTH_PASSWORD_PEPPER = '';
    process.env.AUTH_PEPPER = '';
    process.env.SECRET_SALT = '';
    process.env.AUTH_TENANT_SALT = '';
    process.env.QA_SALT = '';
    process.env.PASSWORD_SALT = '';
  });

  afterEach(() => {
    // Restore env completely after each test to avoid cross-test pollution
    process.env = { ...ORIGINAL_ENV };
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  test('v2 hashing requires tenant.orgSalt, includes optional PEPPER, and verification depends on those values', async () => {
    const tenant = { orgSalt: 'ORG_SALT_A' };
    // With pepper set, compute hash
    process.env.AUTH_PASSWORD_PEPPER = 'pepperA';
    const { hash, version, algo } = await hashPasswordV2('secret-password', tenant);

    expect(typeof hash).toBe('string');
    expect(hash.length).toBeGreaterThan(10);
    expect(version).toBe(2);
    // algo can be 'argon2id'|'bcrypt'|'scrypt' depending on runtime availability
    expect(['argon2id', 'bcrypt', 'scrypt']).toContain(algo);

    // Correct verification with same pepper
    let result = await verifyPassword({
      password: 'secret-password',
      user: { password_hash: hash, hashVersion: 2 },
      tenant,
    });
    expect(result).toEqual({ ok: true, needsMigration: false });

    // Changing pepper should invalidate verification (the input changes)
    process.env.AUTH_PASSWORD_PEPPER = 'pepperB';
    result = await verifyPassword({
      password: 'secret-password',
      user: { password_hash: hash, hashVersion: 2 },
      tenant,
    });
    expect(result.ok).toBe(false);

    // Restore pepper and change tenant orgSalt; should fail
    process.env.AUTH_PASSWORD_PEPPER = 'pepperA';
    const differentTenant = { orgSalt: 'ORG_SALT_B' };
    result = await verifyPassword({
      password: 'secret-password',
      user: { password_hash: hash, hashVersion: 2 },
      tenant: differentTenant,
    });
    expect(result.ok).toBe(false);

    // Wrong password should fail
    result = await verifyPassword({
      password: 'wrong',
      user: { password_hash: hash, hashVersion: 2 },
      tenant,
    });
    expect(result.ok).toBe(false);
  });

  test('hashPassword wrapper defaults to v2 and respects tenant.orgSalt + pepper', async () => {
    const tenant = { orgSalt: 'TENANT_ORG_SALT' };
    process.env.AUTH_PASSWORD_PEPPER = 'peppa';
    const { hash, version } = await hashPassword({ password: 'abc123', tenant });
    expect(version).toBe(2);

    // Verify ok
    const okRes = await verifyPassword({
      password: 'abc123',
      user: { password_hash: hash, hashVersion: 2 },
      tenant,
    });
    expect(okRes).toEqual({ ok: true, needsMigration: false });

    // Pepper mismatch should fail
    process.env.AUTH_PASSWORD_PEPPER = 'different';
    const badRes = await verifyPassword({
      password: 'abc123',
      user: { password_hash: hash, hashVersion: 2 },
      tenant,
    });
    expect(badRes.ok).toBe(false);
  });

  test('verifyAndMigrate: v2 user verifies correctly and rejects wrong password', async () => {
    const tenant = { orgSalt: 'ORG_SALT_V2' };
    process.env.AUTH_PASSWORD_PEPPER = 'pX';
    const { hash, version } = await hashPasswordV2('v2-pass', tenant);
    expect(version).toBe(2);

    const user = { password_hash: hash, hashVersion: 2, _id: 'user123' };

    // Correct password
    let res = await verifyAndMigrate({ candidate: 'v2-pass', user, tenant });
    expect(res).toEqual({ valid: true, migrated: false });

    // Wrong password
    res = await verifyAndMigrate({ candidate: 'nope', user, tenant });
    expect(res).toEqual({ valid: false, migrated: false });
  });

  test('legacy v1 verification succeeds with SECRET_SALT set, and verifyAndMigrate returns migrated=true with new hash/version', async () => {
    // Configure legacy static salt
    process.env.SECRET_SALT = 'legacy_static_salt_1234';
    process.env.AUTH_PASSWORD_PEPPER = ''; // keep pepper empty for clarity
    const password = 'legacy-pass';

    // Create a legacy v1 hash
    const v1 = await hashPasswordV1(password);
    expect(v1.version).toBe(1);
    const user = { password_hash: v1.hash, hashVersion: 1, _id: 'u-legacy-1' };

    // Provide a tenant (orgSalt required for v2 migration)
    const tenant = { orgSalt: 'TENANT_V2_SALT' };

    const res = await verifyAndMigrate({ candidate: password, user, tenant });
    expect(res.valid).toBe(true);
    expect(res.migrated).toBe(true);
    expect(res.newVersion).toBe(2);
    expect(typeof res.newHash).toBe('string');
    expect(res.newHash.length).toBeGreaterThan(10);

    // Demonstrate persistence path (mocked)
    const persist = jest.fn();
    if (res.migrated) {
      persist(user._id, res.newHash, res.newVersion);
    }
    expect(persist).toHaveBeenCalledTimes(1);
    expect(persist).toHaveBeenCalledWith('u-legacy-1', res.newHash, 2);
  });

  test('ensureTenantOrgSalt: generates and persists missing orgSalt (mocked save)', async () => {
    const fakeTenantDoc = {
      tenant_id: 'org-1',
      orgSalt: '',
      orgSaltVersion: undefined,
      save: jest.fn().mockResolvedValue({}),
    };

    const result = await ensureTenantOrgSalt(fakeTenantDoc);
    expect(result).toEqual({ ok: true, updated: true });
    expect(fakeTenantDoc.save).toHaveBeenCalledTimes(1);
    expect(typeof fakeTenantDoc.orgSalt).toBe('string');
    expect(fakeTenantDoc.orgSalt.length).toBeGreaterThan(0);
    expect(fakeTenantDoc.orgSaltVersion).toBe(1);
  });

  test('ensureTenantOrgSalt: no-op when orgSalt already present, does not call save', async () => {
    const fakeTenantDoc = {
      tenant_id: 'org-2',
      orgSalt: 'already_set_salt',
      orgSaltVersion: 1,
      save: jest.fn(),
    };

    const result = await ensureTenantOrgSalt(fakeTenantDoc);
    expect(result).toEqual({ ok: true, updated: false });
    expect(fakeTenantDoc.save).not.toHaveBeenCalled();
  });

  test('ensureTenantOrgSalt: returns ok:false when save fails', async () => {
    const fakeTenantDoc = {
      tenant_id: 'org-3',
      orgSalt: '',
      orgSaltVersion: undefined,
      save: jest.fn().mockRejectedValue(new Error('db write failed')),
    };

    const result = await ensureTenantOrgSalt(fakeTenantDoc);
    expect(result).toEqual({ ok: false, updated: false });
    expect(fakeTenantDoc.save).toHaveBeenCalledTimes(1);
  });

  test('hashing v2 throws when tenant.orgSalt is missing; after ensureTenantOrgSalt hashing works', async () => {
    const tenant = {
      tenant_id: 'org-4',
      orgSalt: '', // missing
      save: jest.fn().mockResolvedValue({}),
    };

    await expect(hashPasswordV2('pass', tenant)).rejects.toThrow(/orgSalt is missing/i);

    const ensured = await ensureTenantOrgSalt(tenant);
    // After generation, hashing should work
    expect(ensured.ok).toBe(true);
    const { hash, version } = await hashPasswordV2('pass', tenant);
    expect(version).toBe(2);
    expect(typeof hash).toBe('string');
  });
});
