import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import * as Device from 'expo-device';
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
    const response = await fetch(`${BACKEND_URL}/register-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, restaurant_code: code, channel_id: channelId }),
    });
    const result = await response.json();
    console.log('=== REGISTER RESULT:', result, 'channel:', channelId);
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

  const debugLog = (message: string) => {
    console.log(`[DBG] ${message}`);
    const shouldSendToBackend = ['SRC:', 'DROP', 'SHOW', 'QUEUED', 'SKIP_DUP', 'ENQUEUE', 'PAYLOAD'].some(keyword => message.includes(keyword));
    if (shouldSendToBackend) {
      AsyncStorage.getItem('restaurant_code').then(code => {
        if (!code) return;
        fetch(`${BACKEND_URL}/log`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message, restaurant_code: code }),
        }).catch(() => {});
      }).catch(() => {});
    }
  };

  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      return false;
    });
    return () => backHandler.remove();
  }, []);
  const showNextInQueue = () => {
    if (orderQueueRef.current.length === 0) {
      modalOpenRef.current = false;
      return;
    }
    const next = orderQueueRef.current.shift();
    setShowOrderModal(false);
    setNewOrderModal(null);
    setShowCountdown(false);
    setTimeout(() => {
      setNewOrderModal(next.order);
      setShowOrderModal(true);
      setShowCountdown(next.showCountdown);
      modalOpenRef.current = true;
    }, 400);
  };

  const enqueueOrder = (order: any, withCountdown: boolean, fromNotification: boolean = false) => {
    if (fromNotification && order.timestamp) {
      const ageMin = Math.floor((Date.now() - order.timestamp) / 60000);
      if (ageMin > 15) {
        debugLog(`DROP old notification order:${order.order_id} age_min:${ageMin}`);
        AsyncStorage.getItem('pending_decision').then(stored => {
          const list: number[] = stored ? JSON.parse(stored) : [];
          const updated = list.filter(id => id !== order.order_id);
          if (updated.length !== list.length) {
            AsyncStorage.setItem('pending_decision', JSON.stringify(updated)).catch(() => {});
            AsyncStorage.setItem('pending_decision_refresh', String(Date.now())).catch(() => {});
          }
        }).catch(() => {});
        return;
      }
    }
    AsyncStorage.getItem('pending_decision').then(stored => {
      debugLog(`ENQUEUE order:${order.order_id} pending:${JSON.stringify(stored ? JSON.parse(stored) : [])}`);
    }).catch(() => {});
    AsyncStorage.getItem('restaurant_code').then(async code => {
      if (!code) return;
      try {
        const res = await fetch(`${BACKEND_URL}/accepted-time/${code}/${order.order_id}`);
        const result = await res.json();
        debugLog(`ENQUEUE order:${order.order_id} server_accepted:${result.accepted_time || 'none'}`);
      } catch (e) {
        debugLog(`ENQUEUE order:${order.order_id} server_check_failed`);
      }
    }).catch(() => {});
    if (modalOpenRef.current) {
      const alreadyQueued = orderQueueRef.current.some(q => q.order.order_id === order.order_id);
      if (!alreadyQueued) {
        orderQueueRef.current.push({ order, showCountdown: withCountdown });
        debugLog(`QUEUED order:${order.order_id} queue:${JSON.stringify(orderQueueRef.current.map(q => q.order.order_id))}`);
      } else {
        debugLog(`SKIP_DUP order:${order.order_id}`);
      }
      return;
    }
    debugLog(`SHOW order:${order.order_id}`);
    modalOpenRef.current = true;
    setNewOrderModal(order);
    setShowOrderModal(true);
    setShowCountdown(withCountdown);
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

    const appStateSubscription = AppState.addEventListener('change', async (nextState) => {
      if (nextState === 'active') {
        const code = await AsyncStorage.getItem('restaurant_code') || '';
        const role = await AsyncStorage.getItem('user_role') || '';
        debugLog(`SRC:AppState-wake code:${code || 'none'} role:${role || 'none'}`);
        if (!code || role !== 'owner') return;
        const debugStored = await AsyncStorage.getItem('pending_decision');
        console.log(`[pending_decision] ON RESUME:`, debugStored ? JSON.parse(debugStored) : []);
        try {
          debugLog(`SRC:AppState-before-fetch code:${code}`);
          const response = await fetch(`${BACKEND_URL}/orders/${code}`);
          debugLog(`SRC:AppState-after-fetch status:${response.status}`);
          const result = await response.json();
          debugLog(`SRC:orders-list ${result.orders ? result.orders.slice(0,5).map((o: any) => `${o.order_id}:${o.status}`).join(',') : 'no-orders'}`);
          if (result.success && result.orders && result.orders.length > 0) {
            // Always update last_seen_order_id to newest order
            await AsyncStorage.setItem('last_seen_order_id', String(result.orders[0].order_id));

            // Scan all recent orders for one that needs a decision
            let orderToShow = null;
            for (const candidate of result.orders.slice(0, 20)) {
              if (candidate.status === 'cancelled' || candidate.status === 'completed') continue;
              try {
                const acceptedRes = await fetch(`${BACKEND_URL}/accepted-time/${code}/${candidate.order_id}`);
                const acceptedResult = await acceptedRes.json();
                if (acceptedResult.success && acceptedResult.accepted_time) continue;
              } catch(e) {}
              orderToShow = candidate;
              break;
            }

            if (!orderToShow) {
              debugLog(`SRC:AppState-resume no-pending-orders scanned:${Math.min(result.orders.length, 20)}`);
            } else {
              debugLog(`SRC:AppState-resume found order:${orderToShow.order_id} status:${orderToShow.status} action:ENQUEUE`);
              if (Platform.OS !== 'ios') {
                AsyncStorage.getItem('pending_decision').then(stored => {
                  const list: number[] = stored ? JSON.parse(stored) : [];
                  if (!list.includes(parseInt(orderToShow.order_id))) {
                    list.push(parseInt(orderToShow.order_id));
                    AsyncStorage.setItem('pending_decision', JSON.stringify(list));
                  }
                }).catch(() => {});
              }
              debugLog(`SRC:AppState order:${orderToShow.order_id}`);
              enqueueOrder({
                order_id: parseInt(orderToShow.order_id),
                customer_name: orderToShow.customer_name || '',
                customer_email: orderToShow.customer_email || '',
                customer_phone: orderToShow.customer_phone || '',
                total: String(orderToShow.total || ''),
                currency: orderToShow.currency || 'CHF',
                status: orderToShow.status || '',
                event_type: 'new_order',
                items: orderToShow.items || [],
                payment_method: orderToShow.payment_method || '',
                note: orderToShow.note || '',
                date: orderToShow.date_created ? formatDate(orderToShow.date_created) : formatDate(new Date().toISOString()),
                timestamp: orderToShow.date_created ? wcDateToMs(orderToShow.date_created) : Date.now(),
                shipping_method: orderToShow.shipping?.method || '',
                shipping_address: orderToShow.shipping?.address || '',
                restaurant_code: orderToShow.restaurant_code || '',
                orderable_order_date: orderToShow.orderable_order_date || '',
                orderable_order_time: orderToShow.orderable_order_time || '',
              }, true);
              setTimeout(() => {
                fetch(`${BACKEND_URL}/accepted-time/${code}/${orderToShow.order_id}`)
                  .then(r => r.json())
                  .then(r => {
                    if (r.success && r.accepted_time) {
                      setShowOrderModal(false);
                      setNewOrderModal(null);
                    }
                  }).catch(() => {});
              }, 3000);
            }
          }
        } catch (e) {}
      }
    });

    const subscription = Notifications.addNotificationReceivedListener(async notification => {
      const data = notification.request.content.data as any;

      if (data.event_type === 'auto_accepted') {
        try {
          const code = await AsyncStorage.getItem('restaurant_code') || '';
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
        } catch(e) {}
        return;
      }

      if (data.event_type === 'new_order') {
        const role = await AsyncStorage.getItem('user_role');
        if (role === 'owner') {
          // Check if already accepted before showing modal
          try {
            const code = await AsyncStorage.getItem('restaurant_code') || '';
            const acceptedRes = await fetch(`${BACKEND_URL}/accepted-time/${code}/${data.order_id}`);
            const acceptedResult = await acceptedRes.json();
            if (acceptedResult.success && acceptedResult.accepted_time) return;
          } catch(e) {}
          const newOrder = {
            order_id: parseInt(data.order_id),
            customer_name: data.customer_name || '',
            customer_email: data.customer_email || '',
            customer_phone: data.customer_phone || '',
            total: data.total || '',
            currency: data.currency || 'CHF',
            status: data.status || '',
            event_type: data.event_type || 'new_order',
            items: JSON.parse(data.items || '[]'),
            payment_method: data.payment_method || '',
            note: data.note || '',
            date: data.date_created ? formatDate(data.date_created) : formatDate(new Date().toISOString()),
            timestamp: data.sent_at ? new Date(data.sent_at).getTime() : (data.date_created ? wcDateToMs(data.date_created) : Date.now()),
            shipping_method: data.shipping_method || '',
            shipping_address: data.shipping_address || '',
            restaurant_code: data.restaurant_code || '',
            orderable_order_time: data.orderable_order_time || '',
            orderable_order_date: data.orderable_order_date || '',
          };
          
          // Save pending_decision BEFORE enqueue so it persists even on force close
          // iOS does not have the AcceptRejectModal so never write to pending_decision there
          if (Platform.OS !== 'ios') {
            AsyncStorage.getItem('pending_decision').then(stored => {
              const list: number[] = stored ? JSON.parse(stored) : [];
              if (!list.includes(newOrder.order_id)) {
                list.push(newOrder.order_id);
                AsyncStorage.setItem('pending_decision', JSON.stringify(list));
                console.log(`[pending_decision] ADDED via notification: ${newOrder.order_id} — list now:`, list);
              } else {
                console.log(`[pending_decision] SKIPPED duplicate via notification: ${newOrder.order_id}`);
              }
            }).catch(() => {});
          }
          debugLog(`SRC:notification order:${newOrder.order_id} age_min:${Math.floor((Date.now() - newOrder.timestamp) / 60000)}`);
          enqueueOrder(newOrder, true, true);
        }
        try {
          const selectedSound = await AsyncStorage.getItem('notification_sound') || 'default';
          if (selectedSound === 'default') return;
          const soundMap: { [key: string]: string } = {
            data_scanner: 'https://assets.mixkit.co/active_storage/sfx/2847/2847.wav',
            security_alarm: 'https://assets.mixkit.co/active_storage/sfx/994/994.wav',
            tick_tock: 'https://assets.mixkit.co/active_storage/sfx/1045/1045.wav',
            classic_alarm: 'https://assets.mixkit.co/active_storage/sfx/995/995.wav',
            slot_machine: 'https://assets.mixkit.co/active_storage/sfx/1995/1995.wav',
          };
          const uri = soundMap[selectedSound];
          if (!uri) return;
          if (orderSoundRef.current) {
            await orderSoundRef.current.stopAsync().catch(() => {});
            await orderSoundRef.current.unloadAsync().catch(() => {});
            orderSoundRef.current = null;
          }
          const { sound } = await Audio.Sound.createAsync({ uri }, { isLooping: true });
          orderSoundRef.current = sound;
          await sound.playAsync();
        } catch (e) {}
      }
    });

    const tapSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as any;
      if (data.order_id && Platform.OS !== 'ios' && data.event_type === 'new_order') {
        const newOrder = {
          order_id: parseInt(data.order_id),
          customer_name: data.customer_name || '',
          customer_email: data.customer_email || '',
          customer_phone: data.customer_phone || '',
          total: data.total || '',
          currency: data.currency || 'CHF',
          status: data.status || '',
          event_type: data.event_type || 'new_order',
          items: JSON.parse(data.items || '[]'),
          payment_method: data.payment_method || '',
          note: data.note || '',
          date: data.date_created ? formatDate(data.date_created) : formatDate(new Date().toISOString()),
          timestamp: data.sent_at ? new Date(data.sent_at).getTime() : (data.date_created ? wcDateToMs(data.date_created) : Date.now()),
          shipping_method: data.shipping_method || '',
          shipping_address: data.shipping_address || '',
          restaurant_code: data.restaurant_code || '',
          orderable_order_time: data.orderable_order_time || '',
          orderable_order_date: data.orderable_order_date || '',
        };
        debugLog(`SRC:tap order:${newOrder.order_id} age_min:${Math.floor((Date.now() - newOrder.timestamp) / 60000)}`);
        enqueueOrder(newOrder, false, true);
      }
    });

    return () => {
      subscription.remove();
      tapSubscription.remove();
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