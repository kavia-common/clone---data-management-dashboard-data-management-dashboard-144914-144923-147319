import { formatLabel } from './formatLabel';

describe('formatLabel', () => {
  it('replaces underscores and capitalizes words', () => {
    expect(formatLabel('user_id')).toBe('User ID');
    expect(formatLabel('tenant_name')).toBe('Tenant Name');
    expect(formatLabel('projects')).toBe('Projects');
  });

  it('handles common acronyms', () => {
    expect(formatLabel('api_url')).toBe('API URL');
    expect(formatLabel('user_ip')).toBe('User IP');
  });

  it('normalizes existing capitalization (upper/mixed inputs)', () => {
    expect(formatLabel('USER_ID')).toBe('User ID');
    expect(formatLabel('API_KEY')).toBe('API Key');
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
