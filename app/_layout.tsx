import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import * as Device from 'expo-device';
import * as Notifications from 'expo-notifications';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, Modal, Platform, ScrollView, StatusBar, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { LanguageProvider } from '../lib/LanguageContext';
import { printOrder } from '../lib/printer';
import { useLanguage } from '../lib/useLanguage';

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
    await Notifications.deleteNotificationChannelAsync('default').catch(() => {});
    await Notifications.setNotificationChannelAsync('default', {
      name: 'FoodUp Orders',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#8B38CB',
      sound: 'default',
      enableVibrate: true,
      showBadge: true,
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
  const [times, setTimes] = useState<number[]>([]);
  const [autoSettings, setAutoSettings] = useState<any>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const { t } = useLanguage();

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

  useEffect(() => {
    if (!visible) {
      setCountdown(null);
      setAutoSettings(null);
      return;
    }
    AsyncStorage.getItem('restaurant_code').then(async code => {
      if (!code) return;
      try {
        const res = await fetch(`${BACKEND_URL}/auto-settings/${code}`);
        const result = await res.json();
        if (result.success && result.settings.auto_action !== 'disabled') {
          setAutoSettings(result.settings);
          setCountdown(result.settings.wait_minutes * 60);
        }
      } catch (e) {}
    });
  }, [visible]);

  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      setCountdown(null);
      onClose();
      return;
    }
    const timer = setTimeout(() => setCountdown(c => (c !== null ? c - 1 : null)), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const handleAutoAction = async () => {
    if (!order || !autoSettings || step !== 'main') return;
    if (autoSettings.auto_action === 'accept') {
      const acceptTime = isScheduled ? `${scheduledTime} — ${scheduledDate}` : autoSettings.accept_time;
      await handleConfirmAcceptWithTime(acceptTime);
    } else if (autoSettings.auto_action === 'reject') {
      await handleConfirmRejectWithReason(autoSettings.reject_reason);
    }
  };
const isScheduled = order ? (
  !!order.orderable_order_time &&
  order.orderable_order_time.trim() !== '' &&
  !order.orderable_order_time.toLowerCase().includes('as soon as possible') &&
  !order.orderable_order_time.toLowerCase().includes('asap') &&
  !order.orderable_order_time.includes('(')
) : false;
const scheduledTime = isScheduled ? order?.orderable_order_time?.replace(/\s*\(.*?\)\s*/g, '').trim() : '';
const scheduledDate = isScheduled ? order?.orderable_order_date : '';
  const reasons = [t.tooBusy, t.restaurantClosed, t.outOfStock, t.other];

  useEffect(() => {
    if (visible) {
      setStep('main');
      setSelectedTime(null);
      setSelectedReason('');
      setCustomReason('');
    }
  }, [visible]);

  if (!order) return null;

  const handleConfirmAcceptWithTime = async (acceptTime: string) => {
    setLoading(true);
    setCountdown(null);
    try {
      const code = await AsyncStorage.getItem('restaurant_code') || '';
      fetch(`${BACKEND_URL}/accepted-time`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurant_code: code,
          order_id: order.order_id,
          accepted_time: acceptTime,
          accepted_at: new Date().toISOString(),
          status: 'accepted',
        }),
      }).catch(() => {});
      const profileRes = await fetch(`${BACKEND_URL}/restaurant-profile/${code}`);
      const profileData = await profileRes.json().catch(() => ({}));
      const website = profileData?.profile?.website;
      if (website) {
        const baseUrl = website.startsWith('http') ? website : `https://${website}`;
        fetch(`${baseUrl}/wp-json/foodup/v1/order-accepted`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secret: 'foodup2026', order_id: order.order_id, accepted_time: acceptTime }),
        }).catch(() => {});
      }
      setLoading(false);
      onClose();
      setTimeout(() => {
        const mins = parseInt(acceptTime);
        const isScheduledTime = acceptTime.includes('—') || acceptTime.includes(':');
        if (isScheduledTime) {
          printOrder(order, undefined, false, '', acceptTime).catch(() => {});
        } else {
          printOrder(order, isNaN(mins) ? 30 : mins).catch(() => {});
        }
      }, 700);
    } catch (e) {
      setLoading(false);
    }
  };

  const handleConfirmRejectWithReason = async (reason: string) => {
    setLoading(true);
    setCountdown(null);
    try {
      const code = await AsyncStorage.getItem('restaurant_code') || '';
      const profileRes = await fetch(`${BACKEND_URL}/restaurant-profile/${code}`);
      const profileData = await profileRes.json().catch(() => ({}));
      const website = profileData?.profile?.website;
      if (website) {
        const baseUrl = website.startsWith('http') ? website : `https://${website}`;
        fetch(`${baseUrl}/wp-json/foodup/v1/order-rejected`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ secret: 'foodup2026', order_id: order.order_id, reason }),
        }).catch(() => {});
      }
      fetch(`${BACKEND_URL}/status-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurant_code: code,
          order_id: order.order_id,
          status: 'cancelled',
          event_type: 'status_update',
          sound: false,
        }),
      }).catch(() => {});
      setLoading(false);
      onClose();
      setTimeout(() => {
        printOrder(order, undefined, true, reason).catch(() => {});
      }, 700);
    } catch (e) {
      setLoading(false);
      onClose();
    }
  };

  const handleConfirmAccept = async () => {
    if (!selectedTime) return;
    setLoading(true);
    setCountdown(null);
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

      // Update WP status and send email
      try {
        const profileRes = await fetch(`${BACKEND_URL}/restaurant-profile/${code}`);
        const profileData = await profileRes.json();
        console.log('=== LAYOUT PROFILE RAW:', JSON.stringify(profileData));
        const website = profileData?.profile?.website;
        console.log('=== LAYOUT WEBSITE:', website);
        if (website) {
          const baseUrl = website.startsWith('http') ? website : `https://${website}`;
          fetch(`${baseUrl}/wp-json/foodup/v1/order-accepted`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              secret: 'foodup2026',
              order_id: order.order_id,
              accepted_time: `${selectedTime} Minutes`,
            }),
          }).catch(e => console.log('wp accept error:', e));
        }
      } catch(e) {}

      setLoading(false);
      onClose();
      setTimeout(() => {
        (isScheduled
          ? printOrder(order, undefined, false, '', `${scheduledTime} — ${scheduledDate}`)
          : printOrder(order, selectedTime)
        ).catch(e => {
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
    setCountdown(null);
    try {
      const code = await AsyncStorage.getItem('restaurant_code') || '';
      const stored = await AsyncStorage.getItem('foodup_orders');
      const existing = stored ? JSON.parse(stored) : [];
      const updated = existing.map((o: any) =>
        o.order_id === order.order_id ? { ...o, status: 'cancelled' } : o
      );
      await AsyncStorage.setItem('foodup_orders', JSON.stringify(updated));
      // Update WP status and send rejection email
      try {
        const profileRes = await fetch(`${BACKEND_URL}/restaurant-profile/${code}`);
        const profileData = await profileRes.json();
        const website = profileData?.profile?.website;
        if (website) {
          const baseUrl = website.startsWith('http') ? website : `https://${website}`;
          fetch(`${baseUrl}/wp-json/foodup/v1/order-rejected`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              secret: 'foodup2026',
              order_id: order.order_id,
              reason: reason,
            }),
          }).catch(e => console.log('wp reject error:', e));
        }
      } catch(e) {}

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
        <View style={{ backgroundColor: '#fff', borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 24, paddingBottom: 80 }}>
          {step === 'main' && (
            <>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                <Text style={{ fontSize: 20, fontWeight: '700', color: '#111' }}>Order #{order.order_id}</Text>
                {countdown !== null && autoSettings && (
                  <Text style={{ fontSize: 18, fontWeight: '900', color: countdown < 60 ? '#e74c3c' : '#f39c12' }}>
                    ⏱ {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}
                  </Text>
                )}
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                <View>
                  <Text style={{ fontSize: 14, color: '#999' }}>{order.customer_name}</Text>
                  <Text style={{ fontSize: 14, color: '#999' }}>{order.currency} {order.total}</Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  {order.orderable_order_time ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Ionicons
                        name={isScheduled ? 'calendar-outline' : 'flash-outline'}
                        size={13}
                        color={isScheduled ? '#8B38CB' : '#f39c12'}
                      />
                      <Text style={{ fontSize: 13, fontWeight: '700', color: isScheduled ? '#8B38CB' : '#f39c12' }}>
                        {isScheduled ? t.scheduled : t.asapShort}
                      </Text>
                    </View>
                  ) : null}
                  {countdown !== null && autoSettings && (
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ fontSize: 11, color: '#999' }}>
                        {autoSettings.auto_action === 'accept' ? t.autoAccept : t.autoReject}:
                      </Text>
                      <Text style={{ fontSize: 11, color: '#999' }}>
                        {autoSettings.auto_action === 'accept' ? (isScheduled ? `${scheduledTime} — ${scheduledDate}` : autoSettings.accept_time) : autoSettings.reject_reason}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
              {order.shipping_address ? (
                <Text style={{ fontSize: 13, color: '#8B38CB', marginBottom: 12 }}>📍 {order.shipping_address}</Text>
              ) : null}
              <View style={{ backgroundColor: '#F7F7F7', borderRadius: 12, padding: 12, marginBottom: 16, maxHeight: 160 }}>
                <ScrollView nestedScrollEnabled>
                  {(order.items || []).map((item: any, i: number) => (
                    <View key={i} style={{ marginBottom: 6 }}>
                      <Text style={{ fontSize: 15, fontWeight: '700', color: '#111' }}>{item.quantity}x {item.name}</Text>
                      {item.addons && item.addons.length > 0 && item.addons.map((addon: any, j: number) => (
                        <Text key={j} style={{ fontSize: 13, color: '#666', paddingLeft: 8 }}>↳ {addon.value}</Text>
                      ))}
                    </View>
                  ))}
                </ScrollView>
              </View>
              <TouchableOpacity
                style={{ backgroundColor: '#2ecc71', borderRadius: 14, padding: 16, alignItems: 'center', marginBottom: 12, flexDirection: 'row', justifyContent: 'center', gap: 8 }}
                onPress={() => { setStep('accept'); setCountdown(null); }}
              >
                <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>{t.acceptOrder}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ backgroundColor: '#e74c3c', borderRadius: 14, padding: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
                onPress={() => { setStep('reject'); setCountdown(null); }}
              >
                <Ionicons name="close-circle-outline" size={20} color="#fff" />
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>{t.rejectOrder}</Text>
              </TouchableOpacity>
            </>
          )}
          {step === 'accept' && (
            <>
              <TouchableOpacity onPress={() => setStep('main')} style={{ marginBottom: 16 }}>
                <Text style={{ color: '#007AFF', fontSize: 14 }}>{t.back}</Text>
              </TouchableOpacity>
              {isScheduled ? (
                <>
                  <Text style={{ fontSize: 18, fontWeight: '700', color: '#111', marginBottom: 8 }}>{t.scheduledOrder}</Text>
                  <View style={{ backgroundColor: '#f5eeff', borderRadius: 12, padding: 16, marginBottom: 24 }}>
                    <Text style={{ fontSize: 14, color: '#8B38CB', fontWeight: '600', marginBottom: 4 }}>🕐 {t.scheduledConfirm}</Text>
                    <Text style={{ fontSize: 22, fontWeight: '900', color: '#8B38CB' }}>{scheduledTime} — {scheduledDate}</Text>
                  </View>
                </>
              ) : (
                <>
                  <Text style={{ fontSize: 18, fontWeight: '700', color: '#111', marginBottom: 16 }}>{t.selectPreparationTime}</Text>
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
                        <Text style={{ fontSize: 15, fontWeight: '600', color: '#111' }}>{time} {t.minutes}</Text>
                        {selectedTime === time && (
                          <Ionicons name="checkmark-circle" size={20} color="#2ecc71" />
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
              <TouchableOpacity
                style={{ backgroundColor: (isScheduled || selectedTime) ? '#111' : '#ccc', borderRadius: 14, padding: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
                onPress={() => {
                  if (isScheduled) {
                    handleConfirmAcceptWithTime(`${scheduledTime} — ${scheduledDate}`);
                  } else {
                    handleConfirmAccept();
                  }
                }}
                disabled={(!isScheduled && !selectedTime) || loading}
              >
                <Ionicons name="print-outline" size={20} color="#fff" />
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>{loading ? t.printing : t.confirmAndPrint}</Text>
              </TouchableOpacity>
            </>
          )}
          {step === 'reject' && (
            <>
              <TouchableOpacity onPress={() => setStep('main')} style={{ marginBottom: 16 }}>
                <Text style={{ color: '#007AFF', fontSize: 14 }}>{t.back}</Text>
              </TouchableOpacity>
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#111', marginBottom: 16 }}>{t.selectRejectionReason}</Text>
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
                  placeholder={t.enterReason}
                  placeholderTextColor={Platform.OS === 'ios' ? '#ADADAD' : '#C0C0C0'}
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
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>{loading ? t.printing : t.confirmAndPrint}</Text>
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
  const orderSoundRef = useRef<any>(null);

  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      return false;
    });
    return () => backHandler.remove();
  }, []);

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
    checkUserRole();

    const appStateSubscription = AppState.addEventListener('change', async (nextState) => {
      if (nextState === 'active') {
        const code = await AsyncStorage.getItem('restaurant_code') || '';
        const role = await AsyncStorage.getItem('user_role') || '';
        if (!code || role !== 'owner') return;
        try {
          const response = await fetch(`${BACKEND_URL}/orders/${code}`);
          const result = await response.json();
          if (result.success && result.orders && result.orders.length > 0) {
            const latestOrder = result.orders[0];
            const lastSeenId = await AsyncStorage.getItem('last_seen_order_id');
            if (String(latestOrder.order_id) !== lastSeenId && latestOrder.status !== 'cancelled') {
              await AsyncStorage.setItem('last_seen_order_id', String(latestOrder.order_id));
            setNewOrderModal({
                order_id: parseInt(latestOrder.order_id),
                customer_name: latestOrder.customer_name || '',
                customer_email: latestOrder.customer_email || '',
                customer_phone: latestOrder.customer_phone || '',
                total: String(latestOrder.total || ''),
                currency: latestOrder.currency || 'CHF',
                status: latestOrder.status || '',
                event_type: 'new_order',
                items: latestOrder.items || [],
                payment_method: latestOrder.payment_method || '',
                note: latestOrder.note || '',
                date: latestOrder.date_created ? new Date(latestOrder.date_created).toLocaleString() : new Date().toLocaleString(),
                timestamp: latestOrder.date_created ? new Date(latestOrder.date_created).getTime() : Date.now(),
                shipping_method: latestOrder.shipping?.method || '',
                shipping_address: latestOrder.shipping?.address || '',
                restaurant_code: latestOrder.restaurant_code || '',
                orderable_order_date: latestOrder.orderable_order_date || '',
                orderable_order_time: latestOrder.orderable_order_time || '',
              });
              setShowOrderModal(true);
            // Check in background if already accepted, close modal if so
            setTimeout(() => {
              fetch(`${BACKEND_URL}/accepted-time/${code}/${latestOrder.order_id}`)
                .then(r => r.json())
                .then(result => {
                  if (result.success && result.accepted_time) {
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
          // Save flag so order card shows print button (canPrint in index.tsx controls visibility)
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
            date: data.date_created ? new Date(data.date_created).toLocaleString() : new Date().toLocaleString(),
            timestamp: data.date_created ? new Date(data.date_created).getTime() : Date.now(),
            shipping_method: data.shipping_method || '',
            shipping_address: data.shipping_address || '',
            restaurant_code: data.restaurant_code || '',
            orderable_order_time: data.orderable_order_time || '',
            orderable_order_date: data.orderable_order_date || '',
          };
          setNewOrderModal(newOrder);
          setShowOrderModal(true);
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
          date: data.date_created ? new Date(data.date_created).toLocaleString() : new Date().toLocaleString(),
          timestamp: data.date_created ? new Date(data.date_created).getTime() : Date.now(),
          shipping_method: data.shipping_method || '',
          shipping_address: data.shipping_address || '',
          restaurant_code: data.restaurant_code || '',
          orderable_order_time: data.orderable_order_time || '',
          orderable_order_date: data.orderable_order_date || '',
        };
        setNewOrderModal(newOrder);
        setShowOrderModal(true);
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
            onClose={async () => {
              if (orderSoundRef.current) {
                await orderSoundRef.current.stopAsync().catch(() => {});
                await orderSoundRef.current.unloadAsync().catch(() => {});
                orderSoundRef.current = null;
              }
              setShowOrderModal(false);
              setNewOrderModal(null);
            }}
          />
        </View>
      )}
    </GestureHandlerRootView>
  );
}