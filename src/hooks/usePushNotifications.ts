import { useCallback, useEffect, useState } from 'react';

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export function usePushNotifications(
  isAuthenticated: boolean,
  apiFetch: <T = any>(url: string, options?: RequestInit) => Promise<T>
) {
  const isSupported =
    typeof window !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in window &&
    'Notification' in window;

  const [permission, setPermission] = useState<NotificationPermission>(
    isSupported ? Notification.permission : 'default'
  );
  const [isSubscribed, setIsSubscribed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const checkSubscription = useCallback(async () => {
    if (!isSupported) return;
    setPermission(Notification.permission);
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const sub = registration ? await registration.pushManager.getSubscription() : null;
      setIsSubscribed(Boolean(sub));
    } catch {
      setIsSubscribed(false);
    }
  }, [isSupported]);

  useEffect(() => {
    checkSubscription();
  }, [checkSubscription, isAuthenticated]);

  const subscribe = useCallback(async () => {
    if (!isSupported) {
      setError('Les notifications push ne sont pas supportées sur ce navigateur.');
      return;
    }
    if (!isAuthenticated) {
      setError('Connectez-vous pour activer les notifications push.');
      return;
    }

    setLoading(true);
    setError(null);
    setFeedback(null);

    try {
      const perm = await Notification.requestPermission();
      setPermission(perm);
      if (perm !== 'granted') {
        setError(
          'Autorisation refusée. Activez les notifications dans les réglages du navigateur.'
        );
        return;
      }

      const registration = await navigator.serviceWorker.ready;
      const { publicKey } = await apiFetch<{ publicKey: string }>('/api/push/vapid-public-key');
      if (!publicKey) {
        throw new Error('Clé VAPID indisponible.');
      }

      let subscription = await registration.pushManager.getSubscription();
      if (!subscription) {
        subscription = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(publicKey) as unknown as BufferSource,
        });
      }

      await apiFetch('/api/push/subscribe', {
        method: 'POST',
        body: JSON.stringify({ subscription: subscription.toJSON() }),
      });

      setIsSubscribed(true);
      setFeedback('Notifications push activées sur cet appareil.');
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : 'Impossible d’activer les notifications push.'
      );
    } finally {
      setLoading(false);
    }
  }, [isSupported, isAuthenticated, apiFetch]);

  const unsubscribe = useCallback(async () => {
    if (!isSupported) return;
    setLoading(true);
    setError(null);
    setFeedback(null);

    try {
      const registration = await navigator.serviceWorker.getRegistration();
      const sub = registration ? await registration.pushManager.getSubscription() : null;
      const endpoint = sub?.endpoint;

      if (sub) {
        await sub.unsubscribe();
      }

      if (isAuthenticated) {
        await apiFetch('/api/push/unsubscribe', {
          method: 'POST',
          body: JSON.stringify({ endpoint }),
        });
      }

      setIsSubscribed(false);
      setFeedback('Notifications push désactivées sur cet appareil.');
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : 'Impossible de désactiver les notifications push.'
      );
    } finally {
      setLoading(false);
    }
  }, [isSupported, isAuthenticated, apiFetch]);

  const sendTestPush = useCallback(async () => {
    if (!isAuthenticated) return;
    setTesting(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await apiFetch<{ ok: boolean; sent: number; total: number }>('/api/push/test', {
        method: 'POST',
      });
      if (res.sent > 0) {
        setFeedback(`Notification test envoyée sur ${res.sent} appareil(s).`);
      } else {
        setFeedback('Notification enregistrée (activez le push sur cet appareil pour la recevoir hors page).');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Échec de l’envoi du test.');
    } finally {
      setTesting(false);
    }
  }, [isAuthenticated, apiFetch]);

  return {
    isSupported,
    permission,
    isSubscribed,
    loading,
    testing,
    feedback,
    error,
    subscribe,
    unsubscribe,
    sendTestPush,
    refreshStatus: checkSubscription,
  };
}
