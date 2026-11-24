const rawBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim().replace(/\/+$/, '');

export function getApiBaseUrl(): string {
  return rawBaseUrl;
}

export function apiUrl(path: string): string {
  if (/^https?:\/\//i.test(path)) {
    return path;
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return rawBaseUrl ? `${rawBaseUrl}${normalizedPath}` : normalizedPath;
}

export function wsUrl(path = '/ws'): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  if (rawBaseUrl) {
    const wsBase = rawBaseUrl.replace(/^http:/i, 'ws:').replace(/^https:/i, 'wss:');
    return `${wsBase}${normalizedPath}`;
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${normalizedPath}`;
}

export function isNativeMobileContainer(): boolean {
  if (typeof window === 'undefined') return false;
  const win = window as unknown as {
    Capacitor?: { isNativePlatform?: () => boolean };
  };
  if (win.Capacitor?.isNativePlatform?.()) return true;
  return (
    window.location.protocol === 'capacitor:' ||
    window.location.protocol === 'ionic:'
  );
}
