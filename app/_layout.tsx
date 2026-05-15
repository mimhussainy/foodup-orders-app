import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Modal, Platform, StatusBar, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { LanguageProvider } from '../lib/LanguageContext';
import { printOrder } from '../lib/printer';

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
    await Notifications.setNotificationChannelAsync('default', {
      name: 'FoodUp Orders',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#8B38CB',
      sound: 'default',
    });
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
    const response = await fetch(`${BACKEND_URL}/register-token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, restaurant_code: code }),
    });
    const result = await response.json();
    console.log('=== REGISTER RESULT:', result);
  } catch (fetchError: any) {
    console.log('=== REGISTER FETCH ERROR:', fetchError?.message || String(fetchError));
  }
}

function AcceptRejectModal({ order, visible, onClose }: { order: any | null, visible: boolean, onClose: () => void }) {
  const [step, setStep] = useState<'main' | 'accept' | 'reject'>('main');
  const [selectedTime, setSelectedTime] = useState<number | null>(null);
  const [selectedReason, setSelectedReason] = useState<string>('');
  const [customReason, setCustomReason] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [times, setTimes] = useState<number[]>([15, 20, 25, 30, 45, 60]);

  useEffect(() => {
    AsyncStorage.getItem('restaurant_code').then(async code => {
      if (!code) return;
      try {
        const res = await fetch(`${BACKEND_URL}/acceptance-times/${code}`);
        const result = await res.json();
        if (result.success) setTimes(result.times);
      } catch (e) {}
    });
  }, [visible]);

  const reasons = ['Too busy', 'Restaurant closed', 'Out of stock', 'Other'];

  useEffect(() => {
    if (visible) {
      setStep('main');
      setSelectedTime(null);
      setSelectedReason('');
      setCustomReason('');
    }
  }, [visible]);

  if (!order) return null;

  const handleConfirmAccept = async () => {
    if (!selectedTime) return;
    setLoading(true);
    try {
      const code = await AsyncStorage.getItem('restaurant_code') || '';
      fetch(`${BACKEND_URL}/accepted-time`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurant_code: code,
          order_id: order.order_id,
          accepted_time: `${selectedTime} Minutes`,
          accepted_at: new Date().toISOString(),
          status: 'accepted',
        }),
      }).catch(e => console.log('accepted-time error:', e));
      setLoading(false);
      onClose();
      setTimeout(() => {
        printOrder(order, selectedTime).catch(e => {
          console.log('print accept error:', e);
        });
      }, 700);
    } catch (e) {
      console.log('accept error:', e);
      setLoading(false);
      onClose();
    }
  };

  const handleConfirmReject = async () => {
    const reason = selectedReason === 'Other' ? customReason : selectedReason;
    if (!reason) return;
    setLoading(true);
    try {
      const code = await AsyncStorage.getItem('restaurant_code') || '';
      const stored = await AsyncStorage.getItem('foodup_orders');
      const existing = stored ? JSON.parse(stored) : [];
      const updated = existing.map((o: any) =>
        o.order_id === order.order_id ? { ...o, status: 'cancelled' } : o
      );
      await AsyncStorage.setItem('foodup_orders', JSON.stringify(updated));
      fetch(`${BACKEND_URL}/status-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurant_code: code,
          order_id: order.order_id,
          status: 'cancelled',
          customer_name: order.customer_name || '',
          customer_phone: order.customer_phone || '',
          total: order.total || '',
          currency: order.currency || 'CHF',
          items: order.items || [],
          payment_method: order.payment_method || '',
          note: order.note || '',
          shipping: {
            method: order.shipping_method || '',
            address: order.shipping_address || '',
          },
          event_type: 'status_update',
          sound: false,
        }),
      }).catch(e => console.log('status-update error:', e));
      setLoading(false);
      onClose();
      setTimeout(() => {
        printOrder(order, undefined, true, reason).catch(e => {
          console.log('print reject error:', e);
        });
      }, 700);
    } catch (e) {
      console.log('reject error:', e);
      setLoading(false);
      onClose();
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' }}>
        <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 40 }}>
          {step === 'main' && (
            <>
              <Text style={{ fontSize: 20, fontWeight: '700', color: '#111', marginBottom: 4 }}>Order #{order.order_id}</Text>
              <Text style={{ fontSize: 14, color: '#999', marginBottom: 24 }}>{order.customer_name} · {order.currency} {order.total}</Text>
              <TouchableOpacity
                style={{ backgroundColor: '#2ecc71', borderRadius: 14, padding: 16, alignItems: 'center', marginBottom: 12, flexDirection: 'row', justifyContent: 'center', gap: 8 }}
                onPress={() => setStep('accept')}
              >
                <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>Accept Order</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ backgroundColor: '#e74c3c', borderRadius: 14, padding: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
                onPress={() => setStep('reject')}
              >
                <Ionicons name="close-circle-outline" size={20} color="#fff" />
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>Reject Order</Text>
              </TouchableOpacity>
              
            </>
          )}
          {step === 'accept' && (
            <>
              <TouchableOpacity onPress={() => setStep('main')} style={{ marginBottom: 16 }}>
                <Text style={{ color: '#007AFF', fontSize: 14 }}>← Back</Text>
              </TouchableOpacity>
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#111', marginBottom: 16 }}>Select Preparation Time</Text>
              <View style={{ marginBottom: 24 }}>
                {times.map((time) => (
                  <TouchableOpacity
                    key={time}
                    onPress={() => setSelectedTime(time)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      paddingVertical: 14,
                      paddingHorizontal: 16,
                      borderRadius: 12,
                      backgroundColor: selectedTime === time ? '#f0fdf4' : '#F5F5F5',
                      marginBottom: 8,
                      borderWidth: selectedTime === time ? 1.5 : 0,
                      borderColor: selectedTime === time ? '#2ecc71' : 'transparent',
                    }}
                  >
                    <Text style={{ fontSize: 15, fontWeight: '600', color: '#111' }}>{time} minutes</Text>
                    {selectedTime === time && (
                      <Ionicons name="checkmark-circle" size={20} color="#2ecc71" />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity
                style={{ backgroundColor: selectedTime ? '#111' : '#ccc', borderRadius: 14, padding: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
                onPress={handleConfirmAccept}
                disabled={!selectedTime || loading}
              >
                <Ionicons name="print-outline" size={20} color="#fff" />
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>{loading ? 'Printing...' : 'Confirm & Print'}</Text>
              </TouchableOpacity>
            </>
          )}
          {step === 'reject' && (
            <>
              <TouchableOpacity onPress={() => setStep('main')} style={{ marginBottom: 16 }}>
                <Text style={{ color: '#007AFF', fontSize: 14 }}>← Back</Text>
              </TouchableOpacity>
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#111', marginBottom: 16 }}>Select Rejection Reason</Text>
              <View style={{ gap: 10, marginBottom: 16 }}>
                {reasons.map(reason => (
                  <TouchableOpacity
                    key={reason}
                    onPress={() => setSelectedReason(reason)}
                    style={{ paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, backgroundColor: selectedReason === reason ? '#e74c3c' : '#F5F5F5' }}
                  >
                    <Text style={{ fontSize: 15, fontWeight: '600', color: selectedReason === reason ? '#fff' : '#111' }}>{reason}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {selectedReason === 'Other' && (
                <TextInput
                  style={{ borderWidth: 1, borderColor: '#E8E8E8', borderRadius: 12, padding: 14, fontSize: 15, color: '#111', marginBottom: 16 }}
                  placeholder="Enter reason..."
                  placeholderTextColor="#C0C0C0"
                  value={customReason}
                  onChangeText={setCustomReason}
                />
              )}
              <TouchableOpacity
                style={{ backgroundColor: selectedReason ? '#e74c3c' : '#ccc', borderRadius: 14, padding: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
                onPress={handleConfirmReject}
                disabled={!selectedReason || loading || (selectedReason === 'Other' && !customReason)}
              >
                <Ionicons name="print-outline" size={20} color="#fff" />
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>{loading ? 'Printing...' : 'Confirm & Print'}</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

export default function RootLayout() {
  const router = useRouter();
  const [newOrderModal, setNewOrderModal] = useState<any>(null);
  const [showOrderModal, setShowOrderModal] = useState(false);

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

    const subscription = Notifications.addNotificationReceivedListener(async notification => {
      const data = notification.request.content.data as any;
      if (data.event_type === 'new_order') {
        const role = await AsyncStorage.getItem('user_role');
        if (role === 'owner' && Platform.OS !== 'ios') {
          const order = {
            order_id: parseInt(data.order_id),
            customer_name: data.customer_name || '',
            customer_email: data.customer_email || '',
            customer_phone: data.customer_phone || '',
            total: data.total || '',
            currency: data.currency || 'CHF',
            status: data.status || '',
            items: JSON.parse(data.items || '[]'),
            payment_method: data.payment_method || '',
            note: data.note || '',
            date: data.date_created ? new Date(data.date_created).toLocaleString() : new Date().toLocaleString(),
            timestamp: data.date_created ? new Date(data.date_created).getTime() : Date.now(),
            shipping_method: data.shipping_method || '',
            shipping_address: data.shipping_address || '',
            restaurant_code: data.restaurant_code || '',
          };
          setNewOrderModal(order);
          setShowOrderModal(true);
        }
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
        if (Platform.OS !== 'ios' && data.event_type === 'new_order') {
          setNewOrderModal(newOrder);
          setShowOrderModal(true);
        }
      }
    });

    return () => {
      subscription.remove();
      tapSubscription.remove();
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
        
      
      {Platform.OS !== 'ios' && (
          <AcceptRejectModal
            order={newOrderModal}
            visible={showOrderModal}
            onClose={() => {
              setShowOrderModal(false);
              setNewOrderModal(null);
            }}
          />
        )}
      </LanguageProvider>
    </GestureHandlerRootView>
  );
}