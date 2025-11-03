/**
 * PUBLIC_INTERFACE
 * useTheme
 * Simple theme hook shim to provide Ocean Professional colors to components that need them.
 * If a real theme provider exists elsewhere, this can be replaced to read from context.
 */
export function useTheme() {
  return {
    name: 'Ocean Professional',
    colors: {
      primary: '#2563EB',
      secondary: '#F59E0B',
      success: '#F59E0B',
      error: '#EF4444',
      background: '#f9fafb',
      surface: '#ffffff',
      text: '#111827',
      grid: '#e5e7eb',
    },
  };
}

/**
 * PUBLIC_INTERFACE
 * getOceanTheme
 * Returns the Ocean Professional theme tokens as a plain object (non-hook usage).
 * Note: does not call React hooks to comply with rules-of-hooks.
 */
export function getOceanTheme() {
  return {
    name: 'Ocean Professional',
    colors: {
      primary: '#2563EB',
      secondary: '#F59E0B',
      success: '#F59E0B',
      error: '#EF4444',
      background: '#f9fafb',
      surface: '#ffffff',
      text: '#111827',
      grid: '#e5e7eb',
    },
  };
}

export default useTheme;
