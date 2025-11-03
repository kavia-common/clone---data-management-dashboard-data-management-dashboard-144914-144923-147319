/**
 * Simple theme hook shim to provide Ocean Professional colors to components that need them.
 * If a real theme provider exists elsewhere, this can be replaced to read from context.
 */
export default function useTheme() {
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
