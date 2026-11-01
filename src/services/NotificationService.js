// src/services/NotificationService.js - Browser Notification Manager
// Provides structured notifications with tag de-duplication and permission handling.

class NotificationService {
  constructor() {
    this.hasRequestedThisSession = false;
  }

  isSupported() {
    return typeof window !== 'undefined' && 'Notification' in window;
  }

  getPermission() {
    if (!this.isSupported()) return 'unsupported';
    return Notification.permission;
  }

  async requestPermission() {
    if (!this.isSupported()) {
      return 'unsupported';
    }

    if (Notification.permission === 'granted') {
      return 'granted';
    }

    if (Notification.permission === 'denied') {
      return 'denied';
    }

    try {
      this.hasRequestedThisSession = true;
      const permission = await Notification.requestPermission();
      return permission;
    } catch (err) {
      console.warn('[NotificationService] Permission request failed:', err);
      return 'default';
    }
  }

  show(title, body, tag = 'fire-alert') {
    if (!this.isSupported()) return;

    if (Notification.permission === 'granted') {
      try {
        new Notification(title, {
          body: body,
          tag: tag, // De-duplicate repeated alerts in OS notification tray
          renotify: true,
          requireInteraction: true,
          icon: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%23b91c1c'><path d='M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z'/></svg>"
        });
      } catch (error) {
        console.error('[NotificationService] Failed to show system notification:', error);
      }
    } else if (Notification.permission === 'default' && !this.hasRequestedThisSession) {
      this.requestPermission();
    }
  }
}

export const notificationService = new NotificationService();
