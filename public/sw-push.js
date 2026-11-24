/* Custom Web Push handlers imported by Workbox Service Worker */

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let payload = {
    title: 'MARCHÉ LIVE',
    body: 'Nouvelle mise à jour sur votre marché.',
    url: '/',
    category: 'general',
  };

  try {
    const parsed = event.data.json();
    payload = { ...payload, ...parsed };
  } catch {
    try {
      payload.body = event.data.text();
    } catch {
      // Fallback to default payload
    }
  }

  const options = {
    body: payload.body,
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    tag: payload.tag || `marche-live-${payload.category || 'general'}`,
    renotify: true,
    data: {
      url: payload.url || '/',
      liveSessionId: payload.liveSessionId || null,
      orderId: payload.orderId || null,
      category: payload.category || 'general',
    },
  };

  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();

  const data = event.notification.data || {};
  const targetUrl = data.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          client.focus();
          client.postMessage({
            type: 'PUSH_NOTIFICATION_CLICK',
            data,
          });
          return;
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
      return undefined;
    })
  );
});
