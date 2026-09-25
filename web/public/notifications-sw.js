/* Web Push only. No fetch handler, offline cache, or stored financial data. */
self.addEventListener('push', (event) => {
  event.waitUntil(self.registration.showNotification('FamilyCard', {
    body: '확인할 알림이 있습니다. 로그인해서 확인해주세요.',
    tag: 'familycard-status',
  }));
});
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow('/alerts'));
});
