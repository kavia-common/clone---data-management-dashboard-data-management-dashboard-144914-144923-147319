'use strict';

/**
 * Unit tests for model defaults and auto-generation related to auth:
 * - Tenant model auto-generates orgSalt on validate (pre-validate hook)
 * - User model defaults hashVersion to 2 for new users
 * - ensureTenantOrgSalt integration mocked through utils is covered in authHash tests
 */

const Tenant = require('./tenant.model');
const User = require('./user.model');

describe('Model defaults for auth-related fields', () => {
  test('Tenant: orgSalt and orgSaltVersion are auto-generated during validate when missing', async () => {
    const t = new Tenant({
      tenant_id: 'tenant_test_1',
      tenant_name: 'Tenant One',
      // No orgSalt provided on purpose
    });

    // Before validate, orgSalt is not present
    expect(t.orgSalt).toBeUndefined();

    // validate() triggers pre('validate') middleware where orgSalt is generated
    await t.validate();

    expect(typeof t.orgSalt).toBe('string');
    expect(t.orgSalt.length).toBeGreaterThan(0);
    expect(t.orgSaltVersion).toBe(1);
  });

  test('User: hashVersion defaults to 2 for new users', () => {
    const u = new User({
      email: 'new@example.com',
    });

    expect(u.hashVersion).toBe(2);
    // password_hash default is null (not set until hashing occurs)
    expect(u.password_hash).toBeNull();
  });
});
