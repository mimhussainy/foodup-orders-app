import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import * as Device from 'expo-device';
import * as Application from 'expo-application';
import { useKeepAwake } from 'expo-keep-awake';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Platform, StatusBar, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import AcceptRejectModal from '../components/AcceptRejectModal';
import { LanguageProvider } from '../lib/LanguageContext';
import { formatDate, wcDateToMs } from '../lib/dateUtils';

const BACKEND_URL = 'https://foodup-order-alerts-backend.onrender.com';
const DEVICE_AUTH_CACHE_MS = 10 * 60 * 1000;
const DEVICE_AUTH_STALE_FALLBACK_MS = 60 * 60 * 1000;

function safeParseItems(value: any): any[] {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
}

async function writeOrderDeviceAuthCache(code: string, registeredDeviceId: string) {
  if (Platform.OS !== 'android') return false;
  const currentDeviceId = String(Application.getAndroidId() || '').trim();
  const normalizedCode = String(code || '').toLowerCase().trim();
  const normalizedRegistered = String(registeredDeviceId || '').trim();
  const allowed = Boolean(
    normalizedCode &&
    currentDeviceId &&
    (!normalizedRegistered || normalizedRegistered === currentDeviceId)
  );

  await AsyncStorage.multiSet([
    ['order_device_auth_code', normalizedCode],
    ['order_device_auth_device_id', currentDeviceId],
    ['order_device_auth_registered_id', normalizedRegistered],
    ['order_device_auth_allowed', allowed ? 'true' : 'false'],
    ['order_device_auth_checked_at', String(Date.now())],
  ]).catch(() => {});

  return allowed;
}

async function readCachedOrderDeviceAuth(code: string, maxAgeMs: number): Promise<boolean | null> {
  if (Platform.OS !== 'android') return false;
  const currentDeviceId = String(Application.getAndroidId() || '').trim();
  const normalizedCode = String(code || '').toLowerCase().trim();
  const values = await AsyncStorage.multiGet([
    'order_device_auth_code',
    'order_device_auth_device_id',
    'order_device_auth_allowed',
    'order_device_auth_checked_at',
  ]).catch(() => [] as [string, string | null][]);
  const map = Object.fromEntries(values as [string, string | null][]);
  const checkedAt = Number(map.order_device_auth_checked_at || 0);
  if (
    map.order_device_auth_code !== normalizedCode ||
    map.order_device_auth_device_id !== currentDeviceId ||
    !checkedAt ||
    Date.now() - checkedAt > maxAgeMs
  ) {
    return null;
  }
  return map.order_device_auth_allowed === 'true';
}

async function isRegisteredOrderDevice(): Promise<boolean> {
  if (Platform.OS !== 'android') return false;

  const code = String(
    (await AsyncStorage.getItem('restaurant_code')) || ''
  ).toLowerCase().trim();
  const deviceId = String(Application.getAndroidId() || '').trim();
  if (!code || !deviceId) return false;

  const cached = await readCachedOrderDeviceAuth(code, DEVICE_AUTH_CACHE_MS);
  if (cached !== null) return cached;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2500);
  try {
    const response = await fetch(
      `${BACKEND_URL}/printer-device/${encodeURIComponent(code)}`,
      { signal: controller.signal }
    );
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const result = await response.json();
    const registeredDeviceId = String(result?.device_id || '').trim();
    return await writeOrderDeviceAuthCache(code, registeredDeviceId);
  } catch (error) {
    // A transient permission-check failure must not silence a device that was
    // recently verified. This avoids turning Render/network latency into a lost order.
    const staleCached = await readCachedOrderDeviceAuth(code, DEVICE_AUTH_STALE_FALLBACK_MS);
    if (staleCached !== null) return staleCached;
    console.log('[device-auth] Unable to verify registered order device:', error);
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

async function registerForPushNotifications() {
  if (!Device.isDevice) {
    console.log('Push notifications only work on a real device');
    return;
  }

  if (Platform.OS === 'android') {
    const selectedSound = await AsyncStorage.getItem('notification_sound') || 'default';

    // Create one channel per sound so Android caches them all
    const soundChannels = [
      { id: 'foodup_default', sound: 'default' },
      { id: 'foodup_data_scanner', sound: 'data_scanner' },
      { id: 'foodup_security_alarm', sound: 'security_alarm' },
      { id: 'foodup_tick_tock', sound: 'tick_tock' },
      { id: 'foodup_classic_alarm', sound: 'classic_alarm' },
      { id: 'foodup_slot_machine', sound: 'slot_machine' },
    ];

    for (const ch of soundChannels) {
      await Notifications.setNotificationChannelAsync(ch.id, {
        name: `FoodUp Orders (${ch.id})`,
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#8B38CB',
        sound: ch.sound === 'default' ? 'default' : `${ch.sound}.wav`,
        enableVibrate: true,
        showBadge: true,
      });
    }
  }

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.log('Notification permission not granted');
    return;
  }

  const code = await AsyncStorage.getItem('restaurant_code') || '';
  if (!code) {
    console.log('No restaurant code found - skipping token registration');
    return;
  }

  let token = '';
  try {
    token = (await Notifications.getExpoPushTokenAsync({
      projectId: 'a057b1fa-8571-453c-a989-a4de0c33949a',
    })).data;
  } catch (tokenError: any) {
    console.log('=== TOKEN ERROR:', tokenError?.message || String(tokenError));
    return;
  }

  console.log('=== DEVICE TOKEN:', token);

  try {
    const selectedSound = await AsyncStorage.getItem('notification_sound') || 'default';
    const channelId = selectedSound === 'default' ? 'foodup_default' : `foodup_${selectedSound}`;

    // Unregister from previous restaurant if different
    const lastRegisteredCode = await AsyncStorage.getItem('last_registered_code') || '';
    const lastRegisteredToken = await AsyncStorage.getItem('last_registered_token') || '';
    if (lastRegisteredCode && lastRegisteredCode !== code && lastRegisteredToken) {
      try {
        await fetch(`${BACKEND_URL}/unregister-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: lastRegisteredToken, restaurant_code: lastRegisteredCode }),
        });
        console.log('=== UNREGISTERED from old restaurant:', lastRegisteredCode);
      } catch (e) {}
    }

    const response = await fetch(`${BACKEND_URL}/register-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, restaurant_code: code, channel_id: channelId }),
    });
    const result = await response.json();
    console.log('=== REGISTER RESULT:', result, 'channel:', channelId);

    // Save current registration info
    await AsyncStorage.setItem('last_registered_code', code);
    await AsyncStorage.setItem('last_registered_token', token);
  } catch (fetchError: any) {
    console.log('=== REGISTER FETCH ERROR:', fetchError?.message || String(fetchError));
  }
}

export default function RootLayout() {
  useKeepAwake();
  const router = useRouter();
  const [newOrderModal, setNewOrderModal] = useState<any>(null);
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [showCountdown, setShowCountdown] = useState(false);
  const orderSoundRef = useRef<any>(null);
  const orderQueueRef = useRef<any[]>([]);
  const modalOpenRef = useRef(false);
  const currentModalOrderIdRef = useRef<number | null>(null);
  const processedNewOrderIdsRef = useRef<Set<number>>(new Set());
  const liveCursorRef = useRef(0);
  const liveSyncRunningRef = useRef(false);
  const liveRestaurantCodeRef = useRef('');

  const debugLog = (message: string) => {
    // Production diagnostics stay on the device. Routine UI events no longer
    // create a Render request plus Redis writes through POST /log.
    console.log(`[DBG] ${message}`);
  };

  useEffect(() => {
    debugLog(`ROOT STATE visible:${showOrderModal} order:${newOrderModal?.order_id ?? 'none'} countdown:${showCountdown} modalRef:${modalOpenRef.current}`);
  }, [showOrderModal, newOrderModal?.order_id, showCountdown]);

  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      return false;
    });
    return () => backHandler.remove();
  }, []);

  const stopOrderSound = async () => {
    if (!orderSoundRef.current) return;
    await orderSoundRef.current.stopAsync().catch(() => {});
    await orderSoundRef.current.unloadAsync().catch(() => {});
    orderSoundRef.current = null;
  };

  const startOrderSound = async (orderId: number) => {
    if (Platform.OS !== 'android') return;
    try {
      const selectedSound = await AsyncStorage.getItem('notification_sound') || 'default';
      const soundMap: { [key: string]: string } = {
        default: 'https://assets.mixkit.co/active_storage/sfx/1045/1045.wav',
        tick_tock: 'https://assets.mixkit.co/active_storage/sfx/1045/1045.wav',
        data_scanner: 'https://assets.mixkit.co/active_storage/sfx/2847/2847.wav',
        security_alarm: 'https://assets.mixkit.co/active_storage/sfx/994/994.wav',
        classic_alarm: 'https://assets.mixkit.co/active_storage/sfx/995/995.wav',
        slot_machine: 'https://assets.mixkit.co/active_storage/sfx/1995/1995.wav',
      };
      const uri = soundMap[selectedSound];
      if (!uri) return;
      await stopOrderSound();
      debugLog(`SOUND START order:${orderId} selected:${selectedSound} uri:${uri}`);
      const { sound } = await Audio.Sound.createAsync({ uri }, { isLooping: true });
      orderSoundRef.current = sound;
      await sound.playAsync();
      debugLog(`SOUND OK order:${orderId} selected:${selectedSound}`);
    } catch (e) {
      debugLog(`SOUND ERROR order:${orderId} error:${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const addPendingDecision = async (orderId: number) => {
    if (Platform.OS === 'ios') return;
    const stored = await AsyncStorage.getItem('pending_decision').catch(() => null);
    const list: number[] = stored ? JSON.parse(stored) : [];
    if (list.includes(orderId)) return;
    const updated = [...list, orderId];
    await AsyncStorage.setItem('pending_decision', JSON.stringify(updated)).catch(() => {});
    await AsyncStorage.setItem('pending_decision_refresh', String(Date.now())).catch(() => {});
  };

  const removePendingDecision = async (orderId: number) => {
    const stored = await AsyncStorage.getItem('pending_decision').catch(() => null);
    const list: number[] = stored ? JSON.parse(stored) : [];
    const updated = list.filter(id => id !== orderId);
    if (updated.length === list.length) return;
    await AsyncStorage.setItem('pending_decision', JSON.stringify(updated)).catch(() => {});
    await AsyncStorage.setItem('pending_decision_refresh', String(Date.now())).catch(() => {});
  };

  const showNextInQueue = () => {
    if (orderQueueRef.current.length === 0) {
      modalOpenRef.current = false;
      currentModalOrderIdRef.current = null;
      return;
    }
    const next = orderQueueRef.current.shift();
    setShowOrderModal(false);
    setNewOrderModal(null);
    setShowCountdown(false);
    currentModalOrderIdRef.current = null;
    setTimeout(() => {
      currentModalOrderIdRef.current = Number(next.order.order_id);
      setNewOrderModal(next.order);
      setShowOrderModal(true);
      setShowCountdown(next.showCountdown);
      modalOpenRef.current = true;
      void startOrderSound(Number(next.order.order_id));
    }, 400);
  };

  const dismissResolvedOrder = async (orderId: number) => {
    orderQueueRef.current = orderQueueRef.current.filter(
      queued => Number(queued.order?.order_id) !== Number(orderId)
    );
    if (currentModalOrderIdRef.current !== Number(orderId)) return;
    await stopOrderSound();
    setShowOrderModal(false);
    setNewOrderModal(null);
    setShowCountdown(false);
    modalOpenRef.current = false;
    currentModalOrderIdRef.current = null;
    setTimeout(showNextInQueue, 250);
  };

  const enqueueOrder = async (order: any, withCountdown: boolean, fromNotification: boolean = false): Promise<boolean> => {
    const orderId = Number(order?.order_id);
    if (!Number.isFinite(orderId)) return false;

    const terminalStatuses = new Set(['completed', 'cancelled', 'refunded', 'failed']);
    if (terminalStatuses.has(String(order.status || '').toLowerCase())) return false;

    if (fromNotification && order.timestamp) {
      const ageMin = Math.floor((Date.now() - order.timestamp) / 60000);
      if (ageMin > 15) {
        debugLog(`DROP old notification order:${orderId} age_min:${ageMin}; live sync will reconcile it`);
        return false;
      }
    }

    if (
      processedNewOrderIdsRef.current.has(orderId) ||
      currentModalOrderIdRef.current === orderId ||
      orderQueueRef.current.some(q => Number(q.order?.order_id) === orderId)
    ) {
      debugLog(`SKIP_DUP order:${orderId}`);
      return false;
    }

    // A delayed notification must never reopen an order that the server already
    // accepted. Bound this safety request so a slow backend cannot delay a live modal.
    const code = await AsyncStorage.getItem('restaurant_code').catch(() => '') || '';
    if (code && fromNotification) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 1200);
      try {
        const res = await fetch(`${BACKEND_URL}/accepted-time/${code}/${orderId}`, { signal: controller.signal });
        const result = await res.json();
        if (result.success && result.accepted_time) {
          debugLog(`DROP accepted order:${orderId}`);
          await removePendingDecision(orderId);
          return false;
        }
      } catch (e) {
        // Live reconciliation below is authoritative; fail open here for immediacy.
      } finally {
        clearTimeout(timeout);
      }
    }

    processedNewOrderIdsRef.current.add(orderId);

    if (modalOpenRef.current) {
      orderQueueRef.current.push({ order, showCountdown: withCountdown });
      debugLog(`QUEUED order:${orderId}`);
      return true;
    }

    debugLog(`SHOW order:${orderId}`);
    modalOpenRef.current = true;
    currentModalOrderIdRef.current = orderId;
    setNewOrderModal(order);
    setShowOrderModal(true);
    setShowCountdown(withCountdown);
    return true;
  };


  const checkUserRole = async () => {
    try {
      const role = await AsyncStorage.getItem('user_role');
      const restaurantCode = await AsyncStorage.getItem('restaurant_code');
      if (!role || !restaurantCode) {
        setTimeout(() => router.replace('/onboarding'), 100);
        return;
      }
      if (role === 'owner') {
        registerForPushNotifications();
      }
      setTimeout(() => {
        router.replace('/(tabs)');
      }, 100);
    } catch (e) {
      router.replace('/onboarding');
    }
  };

  useEffect(() => {
    const sendHeartbeat = async () => {
      try {
        const code = await AsyncStorage.getItem('restaurant_code') || '';
        const role = await AsyncStorage.getItem('user_role') || '';
        if (!code || role !== 'owner') return;
        await fetch(`${BACKEND_URL}/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            restaurant_code: code,
            device_id: Device.modelName || '',
            app_version: '1.0.0',
          }),
        });
      } catch(e) {}
    };

    sendHeartbeat();
    const heartbeatInterval = setInterval(sendHeartbeat, 5 * 60 * 1000);
    return () => clearInterval(heartbeatInterval);
  }, []);

  useEffect(() => {
    checkUserRole();

    const subscription = Notifications.addNotificationReceivedListener(async notification => {
      const data = notification.request.content.data as any;

      if (data.event_type === 'auto_accepted') {
        try {
          const orderId = Number(data.order_id);
          await AsyncStorage.setItem('auto_accepted_refresh', String(Date.now()));
          await AsyncStorage.setItem(`auto_print_${data.order_id}`, JSON.stringify({
            accepted_time: data.accepted_time || '',
            order_id: data.order_id,
            customer_name: data.customer_name || '',
            customer_email: data.customer_email || '',
            customer_phone: data.customer_phone || '',
            total: data.total || '',
            currency: data.currency || 'CHF',
            payment_method: data.payment_method || '',
            note: data.note || '',
            shipping_method: data.shipping_method || '',
            shipping_address: data.shipping_address || '',
            orderable_order_time: data.orderable_order_time || '',
            orderable_order_date: data.orderable_order_date || '',
            date_created: data.date_created || '',
            items: data.items || '[]',
          }));
          if (Number.isFinite(orderId)) {
            await removePendingDecision(orderId);
            await dismissResolvedOrder(orderId);
          }
        } catch(e) {}
        return;
      }

      if (data.event_type === 'new_order') {
        const role = await AsyncStorage.getItem('user_role');
        if (role !== 'owner') return;

        const currentCode = String(await AsyncStorage.getItem('restaurant_code') || '').toLowerCase().trim();
        const incomingCode = String(data.restaurant_code || '').toLowerCase().trim();
        if (incomingCode && incomingCode !== currentCode) {
          debugLog(`DROP cross-restaurant notification order:${data.order_id} from:${incomingCode} current:${currentCode}`);
          return;
        }

        // iOS keeps the normal system notification path. Android uses the custom
        // modal/ringing path only on the registered order device.
        if (Platform.OS !== 'android') {
          debugLog(`SYSTEM NOTIFICATION SOUND ONLY order:${data.order_id} platform:${Platform.OS}`);
          return;
        }

        if (!(await isRegisteredOrderDevice())) {
          debugLog(`NOTIFICATION ONLY order:${data.order_id} - modal/ringing suppressed on non-registered Android device`);
          return;
        }

        const newOrder = {
          order_id: parseInt(String(data.order_id || '0'), 10),
          customer_name: data.customer_name || '',
          customer_email: data.customer_email || '',
          customer_phone: data.customer_phone || '',
          total: data.total || '',
          currency: data.currency || 'CHF',
          status: data.status || '',
          event_type: data.event_type || 'new_order',
          items: safeParseItems(data.items),
          payment_method: data.payment_method || '',
          note: data.note || '',
          date: data.date_created ? formatDate(data.date_created) : formatDate(new Date().toISOString()),
          timestamp: data.sent_at ? new Date(data.sent_at).getTime() : (data.date_created ? wcDateToMs(data.date_created) : Date.now()),
          received_at: data.received_at || data.sent_at || '',
          shipping_method: data.shipping_method || '',
          shipping_address: data.shipping_address || '',
          restaurant_code: data.restaurant_code || '',
          fulfillment_type: data.fulfillment_type || '',
          orderable_order_time: data.orderable_order_time || '',
          orderable_order_date: data.orderable_order_date || '',
          date_created: data.date_created || '',
        };

        await addPendingDecision(newOrder.order_id);
        debugLog(`SRC:notification order:${newOrder.order_id} age_min:${Math.floor((Date.now() - newOrder.timestamp) / 60000)}`);
        const enqueued = await enqueueOrder(newOrder, true, true);
        if (enqueued) await startOrderSound(newOrder.order_id);
      }
    });

    const tapSubscription = Notifications.addNotificationResponseReceivedListener(async (response) => {
      const data = response.notification.request.content.data as any;
      if (data.order_id && Platform.OS !== 'ios' && data.event_type === 'new_order') {
        const currentCode = String(await AsyncStorage.getItem('restaurant_code') || '').toLowerCase().trim();
        const incomingCode = String(data.restaurant_code || '').toLowerCase().trim();
        if (incomingCode && incomingCode !== currentCode) {
          debugLog(`DROP cross-restaurant tap order:${data.order_id} from:${incomingCode} current:${currentCode}`);
          return;
        }

        // The notification can still open the app normally,
        // but a non-registered Android device must not open
        // the Accept/Reject modal.
        if (
          Platform.OS === 'android' &&
          !(await isRegisteredOrderDevice())
        ) {
          debugLog(
            `NOTIFICATION TAP ONLY order:${data.order_id} - modal suppressed on non-registered Android device`
          );
          return;
        }

        const newOrder = {
          order_id: parseInt(data.order_id),
          customer_name: data.customer_name || '',
          customer_email: data.customer_email || '',
          customer_phone: data.customer_phone || '',
          total: data.total || '',
          currency: data.currency || 'CHF',
          status: data.status || '',
          event_type: data.event_type || 'new_order',
          items: safeParseItems(data.items),
          payment_method: data.payment_method || '',
          note: data.note || '',
          date: data.date_created ? formatDate(data.date_created) : formatDate(new Date().toISOString()),
          timestamp: data.sent_at ? new Date(data.sent_at).getTime() : (data.date_created ? wcDateToMs(data.date_created) : Date.now()),
          received_at: data.received_at || data.sent_at || '',
          shipping_method: data.shipping_method || '',
          shipping_address: data.shipping_address || '',
          restaurant_code: data.restaurant_code || '',
          fulfillment_type: data.fulfillment_type || '',
          orderable_order_time: data.orderable_order_time || '',
          orderable_order_date: data.orderable_order_date || '',
        };
        debugLog(`SRC:tap order:${newOrder.order_id} age_min:${Math.floor((Date.now() - newOrder.timestamp) / 60000)}`);
        await addPendingDecision(newOrder.order_id);
        await enqueueOrder(newOrder, true, true);
      }
    });

    return () => {
      subscription.remove();
      tapSubscription.remove();
    };
  }, []);

  // ---------------------------------------------------------------------------
  // LIVE RECONCILIATION
  // ---------------------------------------------------------------------------
  // Expo/FCM push delivery can be delayed by Android, networking, or the provider.
  // Push remains the fastest path, but it is no longer allowed to be the only path.
  // While the owner app is foregrounded, reconcile with the backend every 5 seconds.
  // This restores missed orders, Review state, auto-accepted state, modal and ringing.
  useEffect(() => {
    let stopped = false;

    const normalizeBackendOrder = (raw: any) => {
      const dateCreated = String(raw?.date_created || '');
      const receivedAt = String(raw?.received_at || '');
      return {
        order_id: Number(raw?.order_id || 0),
        customer_name: String(raw?.customer_name || ''),
        customer_email: String(raw?.customer_email || ''),
        customer_phone: String(raw?.customer_phone || ''),
        total: String(raw?.total || ''),
        currency: String(raw?.currency || 'CHF'),
        status: String(raw?.status || ''),
        event_type: String(raw?.event_type || 'new_order'),
        items: safeParseItems(raw?.items),
        payment_method: String(raw?.payment_method || ''),
        note: String(raw?.note || ''),
        date: dateCreated ? formatDate(dateCreated) : formatDate(new Date().toISOString()),
        timestamp: receivedAt
          ? new Date(receivedAt).getTime()
          : (dateCreated ? wcDateToMs(dateCreated) : Date.now()),
        received_at: receivedAt,
        shipping_method: String(raw?.shipping?.method || raw?.shipping_method || ''),
        shipping_address: String(raw?.shipping?.address || raw?.shipping_address || ''),
        restaurant_code: String(raw?.restaurant_code || ''),
        fulfillment_type: String(raw?.fulfillment_type || ''),
        orderable_order_time: String(raw?.orderable_order_time || ''),
        orderable_order_date: String(raw?.orderable_order_date || ''),
        date_created: dateCreated,
        auto_actioned: Boolean(raw?.auto_actioned),
      };
    };

    const shouldRecoverForDecision = (order: any) => {
      const status = String(order?.status || '').toLowerCase();
      if (['completed', 'cancelled', 'refunded', 'failed'].includes(status)) return false;

      const orderTime = String(order?.orderable_order_time || '').toLowerCase().trim();
      const orderDate = String(order?.orderable_order_date || '').trim();
      const isAsap = orderTime.includes('as soon as possible') || orderTime.includes('asap');
      const isScheduled = Boolean((orderDate || orderTime) && !isAsap);

      const ageMs = Date.now() - Number(order?.timestamp || Date.now());
      if (!isScheduled) return ageMs <= 3 * 60 * 60 * 1000;

      // A scheduled order may be created much earlier. Keep it recoverable until
      // three hours after its scheduled time when the date/time can be parsed.
      const cleanTime = String(order?.orderable_order_time || '').replace(/\s*\(.*?\)\s*/g, '').trim();
      const dmy = orderDate.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
      const iso = orderDate.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
      const hm = cleanTime.match(/^(\d{1,2}):(\d{2})$/);
      if (!hm || (!dmy && !iso)) return ageMs <= 24 * 60 * 60 * 1000;

      const year = dmy ? Number(dmy[3]) : Number(iso?.[1]);
      const month = dmy ? Number(dmy[2]) : Number(iso?.[2]);
      const day = dmy ? Number(dmy[1]) : Number(iso?.[3]);
      const scheduledMs = new Date(year, month - 1, day, Number(hm[1]), Number(hm[2]), 0, 0).getTime();
      return Number.isFinite(scheduledMs) && Date.now() <= scheduledMs + 3 * 60 * 60 * 1000;
    };

    const buildAutoPrintPayload = (order: any, accepted: any) => ({
      accepted_time: String(accepted?.accepted_time || ''),
      order_id: String(order?.order_id || ''),
      customer_name: String(order?.customer_name || ''),
      customer_email: String(order?.customer_email || ''),
      customer_phone: String(order?.customer_phone || ''),
      total: String(order?.total || ''),
      currency: String(order?.currency || 'CHF'),
      payment_method: String(order?.payment_method || ''),
      note: String(order?.note || ''),
      shipping_method: String(order?.shipping?.method || order?.shipping_method || ''),
      shipping_address: String(order?.shipping?.address || order?.shipping_address || ''),
      orderable_order_time: String(order?.orderable_order_time || ''),
      orderable_order_date: String(order?.orderable_order_date || ''),
      date_created: String(order?.date_created || ''),
      items: Array.isArray(order?.items) ? order.items : safeParseItems(order?.items),
    });

    const syncLiveOrders = async () => {
      if (stopped || liveSyncRunningRef.current || AppState.currentState !== 'active') return;
      liveSyncRunningRef.current = true;

      try {
        const [codeRaw, role] = await Promise.all([
          AsyncStorage.getItem('restaurant_code'),
          AsyncStorage.getItem('user_role'),
        ]);
        const code = String(codeRaw || '').toLowerCase().trim();
        if (!code || role !== 'owner') return;

        if (liveRestaurantCodeRef.current !== code) {
          liveRestaurantCodeRef.current = code;
          liveCursorRef.current = 0;
          processedNewOrderIdsRef.current.clear();
        }

        const pendingStored = await AsyncStorage.getItem('pending_decision').catch(() => null);
        const pendingIds: number[] = pendingStored ? JSON.parse(pendingStored) : [];
        const pendingQuery = pendingIds.slice(0, 40).join(',');

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 4500);
        let result: any;
        try {
          const response = await fetch(
            `${BACKEND_URL}/live-sync/${encodeURIComponent(code)}?after=${liveCursorRef.current}&limit=30&pending=${encodeURIComponent(pendingQuery)}`,
            { signal: controller.signal }
          );
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          result = await response.json();
        } finally {
          clearTimeout(timeout);
        }

        if (!result?.success) return;

        let authorizedOrderDevice = false;
        if (Platform.OS === 'android') {
          if (result.device_state_included) {
            const registeredDeviceId = String(result.printer_device_id || '');
            authorizedOrderDevice = await writeOrderDeviceAuthCache(code, registeredDeviceId);
          } else {
            const cachedAuth = await readCachedOrderDeviceAuth(code, DEVICE_AUTH_STALE_FALLBACK_MS);
            authorizedOrderDevice = cachedAuth === true;
          }
        }

        const stateOrderMap = new Map<string, any>();
        for (const raw of [...(result.state_orders || []), ...(result.orders || [])]) {
          stateOrderMap.set(String(raw?.order_id || ''), raw);
        }

        // First resolve server-side decisions. This is authoritative even if the
        // corresponding push never reached the device.
        for (const [orderIdText, state] of Object.entries<any>(result.states || {})) {
          const orderId = Number(orderIdText);
          if (!Number.isFinite(orderId)) continue;

          if (state?.accepted || state?.rejected) {
            await removePendingDecision(orderId);
            await dismissResolvedOrder(orderId);
            await AsyncStorage.setItem('orders_live_refresh', String(Date.now())).catch(() => {});
          }

          if (state?.auto_accepted && state?.accepted) {
            const rawOrder = stateOrderMap.get(orderIdText);
            if (rawOrder) {
              await AsyncStorage.setItem(
                `auto_print_${orderId}`,
                JSON.stringify(buildAutoPrintPayload(rawOrder, state.accepted))
              ).catch(() => {});
              await AsyncStorage.setItem('auto_accepted_refresh', String(Date.now())).catch(() => {});
            }
          }
        }

        const discoveredOrders = Array.isArray(result.orders) ? result.orders : [];
        if (discoveredOrders.length > 0) {
          await AsyncStorage.setItem('orders_live_refresh', String(Date.now())).catch(() => {});
        }

        for (const raw of discoveredOrders) {
          const order = normalizeBackendOrder(raw);
          if (!Number.isFinite(order.order_id) || order.order_id <= 0) continue;

          const state = result.states?.[String(order.order_id)] || {};
          if (state.accepted || state.rejected) continue;
          order.auto_actioned = Boolean(state.auto_actioned);
          if (!shouldRecoverForDecision(order)) continue;
          if (!authorizedOrderDevice) continue;

          await addPendingDecision(order.order_id);
          debugLog(`SRC:live-sync order:${order.order_id} cursor:${liveCursorRef.current}`);
          const enqueued = await enqueueOrder(order, true, false);
          if (enqueued && currentModalOrderIdRef.current === order.order_id) {
            await startOrderSound(order.order_id);
          }
        }

        if (Number.isFinite(Number(result.cursor))) {
          liveCursorRef.current = Math.max(liveCursorRef.current, Number(result.cursor));
        }
      } catch (e) {
        debugLog(`LIVE SYNC ERROR ${e instanceof Error ? e.message : String(e)}`);
      } finally {
        liveSyncRunningRef.current = false;
      }
    };

    void syncLiveOrders();
    const interval = setInterval(() => void syncLiveOrders(), 5000);
    const appStateSubscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') {
        // Foreground recovery should not wait for the next interval tick.
        void syncLiveOrders();
        void registerForPushNotifications();
      }
    });

    return () => {
      stopped = true;
      clearInterval(interval);
      appStateSubscription.remove();
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar barStyle="dark-content" backgroundColor="#ffffff" translucent={false} />
      <LanguageProvider>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        </Stack>
      </LanguageProvider>
      {Platform.OS !== 'ios' && (
        <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 9999, pointerEvents: showOrderModal ? 'auto' : 'none' }}>
          <AcceptRejectModal
            order={newOrderModal}
            visible={showOrderModal}
            showCountdown={showCountdown}
            onClose={async () => {
              debugLog(`MODAL onClose order:${newOrderModal?.order_id ?? 'none'}`);
              if (orderSoundRef.current) {
                await orderSoundRef.current.stopAsync().catch(() => {});
                await orderSoundRef.current.unloadAsync().catch(() => {});
                orderSoundRef.current = null;
              }
              setShowOrderModal(false);
              setNewOrderModal(null);
              setShowCountdown(false);
              showNextInQueue();
            }}
          />
        </View>
      )}
    
    </GestureHandlerRootView>
  );
}
