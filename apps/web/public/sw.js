// Service Worker for nailby.ank Background Push Notifications
// PART 3 OF WEB PUSH ARCHITECTURE: Receive push payloads from downstream systems
// and display native toast notifications when browser/app is in background.

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  if (!event.data) return;

  let data = {};
  try {
    data = event.data.json();
  } catch (e) {
    data = { body: event.data.text() };
  }

  const title = data.title || "Có đơn hàng mới tại nailby.ank!";
  const options = {
    body: data.body || "Có hoạt động mới vừa diễn ra. Vào app nhận lịch ngay!",
    icon: '/logo-192.png',
    badge: '/logo-192.png',
    tag: data.tag || 'nailby-ank-push',
    vibrate: [200, 100, 200, 100, 200, 100, 200],
    data: { 
      url: data.url || '/' 
    }
  };

  const promise = self.registration.showNotification(title, options);

  event.waitUntil(promise);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  
  const targetUrl = event.notification.data?.url || '/';

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // If a window is already open, focus it
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      // Otherwise list is empty, open a new window
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
