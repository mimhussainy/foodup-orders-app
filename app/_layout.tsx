import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter } from 'expo-router';
import { useEffect } from 'react';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { LanguageProvider } from '../lib/LanguageContext';

const BACKEND_URL = 'https://foodup-order-alerts-backend.onrender.com';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: true,
  }),
});

async function unregisterPushNotifications() {
  // Keep tokens registered so owner always receives notifications
}

async function registerForPushNotifications() {
  if (!Device.isDevice) return;
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== 'granted') return;
  const code = await AsyncStorage.getItem('restaurant_code') || '';
  console.log('Registering push token for restaurant:', code);
  if (!code) {
    console.log('No restaurant code found - skipping token registration');
    return;
  }
  const token = (await Notifications.getExpoPushTokenAsync({
    projectId: 'a057b1fa-8571-453c-a989-a4de0c33949a',
  })).data;
  console.log('Token:', token);
  const response = await fetch(`${BACKEND_URL}/register-token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, restaurant_code: code }),
  });
  const result = await response.json();
  console.log('Register result:', result);
}

export default function RootLayout() {
  const router = useRouter();

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
      } else if (role === 'delivery') {
        // Don't unregister - owner token stays active
      }
      setTimeout(() => {
              if (role === 'delivery') {
                router.replace('/(tabs)/delivery');
              } else {
                router.replace('/(tabs)');
              }
            }, 100);
          } catch (e) {
            router.replace('/onboarding');
          }
        };  
  useEffect(() => {
    checkUserRole();
    Notifications.setBadgeCountAsync(0);
    Notifications.dismissAllNotificationsAsync();

    const subscription = Notifications.addNotificationReceivedListener(async notification => {
      Notifications.setBadgeCountAsync(0);
      Notifications.dismissAllNotificationsAsync();
      const data = notification.request.content.data as any;
      if (data.event_type === 'new_order') {
        try {
          const selectedSound = await AsyncStorage.getItem('notification_sound') || 'default';
          if (selectedSound === 'default') return;
          const soundMap: { [key: string]: string } = {
            cash: 'https://assets.mixkit.co/active_storage/sfx/2003/2003-preview.mp3',
            bell: 'https://assets.mixkit.co/active_storage/sfx/2869/2869-preview.mp3',
            chime: 'https://assets.mixkit.co/active_storage/sfx/2867/2867-preview.mp3',
          };
          const uri = soundMap[selectedSound];
          if (!uri) return;
          const { sound } = await Audio.Sound.createAsync({ uri });
          await sound.playAsync();
          sound.setOnPlaybackStatusUpdate((status: any) => {
            if (status.isLoaded && status.didJustFinish) sound.unloadAsync();
          });
        } catch (e) {}
      }
    });

    const tapSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      Notifications.setBadgeCountAsync(0);
      const data = response.notification.request.content.data as any;
      if (data.order_id) {
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
          date: data.date_created ? new Date(data.date_created).toLocaleString() : new Date().toLocaleString(),
          timestamp: data.date_created ? new Date(data.date_created).getTime() : Date.now(),
          shipping_method: data.shipping_method || '',
          shipping_address: data.shipping_address || '',
          restaurant_code: data.restaurant_code || '',
        };
        AsyncStorage.getItem('foodup_orders').then(stored => {
          const existing = stored ? JSON.parse(stored) : [];
          const exists = existing.findIndex((o: any) => o.order_id === newOrder.order_id);
          if (exists === -1) {
            const updated = [newOrder, ...existing];
            AsyncStorage.setItem('foodup_orders', JSON.stringify(updated));
          }
        });
      }
    });

    return () => {
      subscription.remove();
      tapSubscription.remove();
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <LanguageProvider>
        <Stack>
          <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
          <Stack.Screen name="onboarding" options={{ headerShown: false }} />
        </Stack>
      </LanguageProvider>
    </GestureHandlerRootView>
  );
}