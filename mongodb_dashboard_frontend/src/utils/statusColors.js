import getOceanColors from '../theme/colors';

/**
 * PUBLIC_INTERFACE
 * getStatusColor
 * Returns a color string for a given status using theme tokens when available.
 */
export function getStatusColor(status) {
  const tokens = (typeof getOceanColors === 'function' ? getOceanColors() : {}) || {};
  const map = {
    active: tokens.success || '#10B981',
    deleted: tokens.error || '#EF4444',
    disabled: '#9CA3AF',
    pending: tokens.secondary || '#F59E0B',
    unknown: '#6B7280',
  };
  return map[(status || '').toLowerCase()] || map.unknown;
}
