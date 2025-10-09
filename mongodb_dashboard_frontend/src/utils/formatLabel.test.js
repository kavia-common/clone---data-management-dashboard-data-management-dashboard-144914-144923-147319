import { formatLabel } from './formatLabel';

describe('formatLabel', () => {
  it('replaces underscores and capitalizes words', () => {
    expect(formatLabel('user_id')).toBe('User ID');
    expect(formatLabel('tenant_name')).toBe('Tenant Name');
  });

  it('handles common acronyms', () => {
    expect(formatLabel('api_url')).toBe('API URL');
    expect(formatLabel('user_ip')).toBe('User IP');
  });

  it('handles empty and null safely', () => {
    expect(formatLabel('')).toBe('');
    expect(formatLabel(null)).toBe('');
    expect(formatLabel(undefined)).toBe('');
  });

  it('trims and compresses whitespace/underscores', () => {
    expect(formatLabel('  project__id  ')).toBe('Project ID');
  });

  it('formats _id nicely', () => {
    expect(formatLabel('_id')).toBe('ID');
  });
});
