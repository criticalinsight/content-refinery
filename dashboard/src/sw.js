import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching'

// Precache resources
cleanupOutdatedCaches()
precacheAndRoute(self.__WB_MANIFEST)

// Push Notification Listener
self.addEventListener('push', (event) => {
    const data = event.data?.json() ?? { title: 'New Signal', body: 'New Alpha detected!' }

    const options = {
        body: data.body,
        icon: '/icon.png',
        badge: '/icon.png',
        data: data.url || '/',
        vibrate: [100, 50, 100]
    }

    event.waitUntil(
        self.registration.showNotification(data.title, options)
    )
})

// Notification Click Listener
self.addEventListener('notificationclick', (event) => {
    event.notification.close()
    event.waitUntil(
        clients.openWindow(event.notification.data)
    )
})
