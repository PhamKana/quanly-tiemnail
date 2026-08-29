export function getNotificationPermissionState(): NotificationPermission {
  if (!('Notification' in window)) {
    return 'denied';
  }
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!('Notification' in window)) {
    return 'denied';
  }
  const permission = await Notification.requestPermission();
  return permission;
}

export async function registerServiceWorkerAndSubscribe(
  _role?: string,
  _userName?: string
): Promise<void> {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
    console.warn("Push messaging is not supported.");
    return;
  }

  try {
    const session = readStoredSession();
    if (!session) return;
    const swReg = await navigator.serviceWorker.register('/sw.js');
    const response = await fetch('/api/push-public-key');
    const data = await response.json();
    
    if (data.publicKey) {
      const subscription = await swReg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: data.publicKey
      });
      
      await fetch('/api/push-subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...getAuthHeaders(session) },
        body: JSON.stringify({ subscription })
      });
    }
  } catch (error) {
    console.error('Service Worker Error', error);
  }
}

export function showLocalNotificationOnly(title: string, body: string, tag: string, url?: string): void {
  if (getNotificationPermissionState() === 'granted') {
    new Notification(title, { body, tag });
  }
}

export function triggerPushNotification(title: string, body: string, tag: string, url?: string): void {
  const session = readStoredSession();
  if (!session) return;
  fetch('/api/push-notify-all', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...getAuthHeaders(session) },
    body: JSON.stringify({ title, body, tag, url })
  }).catch(console.error);
}
import { getAuthHeaders, readStoredSession } from '@/shared/lib/auth';
