import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { useEffect, useState } from 'react';
import {
  Modal, Platform,
  ScrollView, Text, TextInput, TouchableOpacity, View
} from 'react-native';
import { formatAddress } from '../lib/formatters';
import { getTranslation, Language } from '../lib/i18n';
import { printOrder } from '../lib/printer';

const BACKEND_URL = 'https://foodup-order-alerts-backend.onrender.com';

async function scheduleScheduledOrderReminder(order: any, acceptTime: string, t: any) {
  try {
    const parts = acceptTime.split('—');
    if (parts.length < 2) return;
    const timePart = parts[0].trim();
    const datePart = parts[1].trim().split('/');
    if (datePart.length < 3) return;
    const scheduledMs = new Date(`${datePart[2]}-${datePart[1]}-${datePart[0]}T${timePart}:00`).getTime();
    const reminderMs = scheduledMs - 30 * 60 * 1000;
    const now = Date.now();
    if (reminderMs <= now) return;
    const secondsUntilReminder = Math.floor((reminderMs - now) / 1000);
    await Notifications.scheduleNotificationAsync({
      content: {
        title: `⏰ ${t.scheduledOrderReminder}`,
        body: `${t.orderNumber} #${order.order_id} ${t.scheduledReminderFor} ${order.customer_name} ${t.scheduledReminderDue} (${timePart})`,
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: secondsUntilReminder,
      },
    });
  } catch (e) {}
}

async function postDecisionAction(path: string, body: any) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(`${BACKEND_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || result.success === false) {
      console.log(`Decision action failed: ${path}`, result.message || response.status);
    }
    return result;
  } catch (e) {
    console.log(`Decision action failed: ${path}`, e);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}


async function postWordPressDecision(
  url: string,
  body: Record<string, unknown>
): Promise<void> {
  let lastError: unknown = new Error(
    'WooCommerce decision synchronization failed'
  );

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 7000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const result: any = await response
        .json()
        .catch(() => ({}));

      if (!response.ok || result?.success !== true) {
        throw new Error(
          'WooCommerce synchronization failed with HTTP ' + response.status
        );
      }

      return;
    } catch (error) {
      lastError = error;

      if (attempt < 3) {
        await new Promise(resolve =>
          setTimeout(resolve, attempt * 500)
        );
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw (
    lastError instanceof Error
      ? lastError
      : new Error('WooCommerce decision synchronization failed')
  );
}

interface AcceptRejectModalProps {
  order: any | null;
  visible: boolean;
  onClose: () => void;
  onDecisionMade?: (orderId: number) => void;
  showCountdown?: boolean; // true only for live foreground notifications
}

export default function AcceptRejectModal({ order, visible, onClose, onDecisionMade, showCountdown = false }: AcceptRejectModalProps) {
  const [step, setStep] = useState<'main' | 'accept' | 'reject'>('main');
  const [selectedTime, setSelectedTime] = useState<number | null>(null);
  const [selectedReason, setSelectedReason] = useState<string>('');
  const [customReason, setCustomReason] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [times, setTimes] = useState<number[]>([15, 20, 25, 30, 45, 60]);
  const [autoSettings, setAutoSettings] = useState<any>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [modalLang, setModalLang] = useState<Language>('en');

  useEffect(() => {
    if (!visible) return;

    AsyncStorage.getItem('app_language').then(async appLang => {
      const fallbackLang = await AsyncStorage.getItem('language');
      const rawLang = String(appLang || fallbackLang || 'en').toLowerCase();

      setModalLang(rawLang === 'de' ? 'de' : 'en');
    }).catch(() => {});
  }, [visible]);

  const t = getTranslation(modalLang);

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

  // Fetch acceptance times from backend
  useEffect(() => {
    AsyncStorage.getItem('restaurant_code').then(async code => {
      if (!code) return;
      try {
        const res = await fetch(`${BACKEND_URL}/acceptance-times/${code}`);
        const result = await res.json();
        if (result.success && result.times?.length > 0) setTimes(result.times);
      } catch (e) {}
    });
  }, [visible]);

  // Handle auto settings, countdown, and backend cancellation
  useEffect(() => {
    if (!visible) {
      setCountdown(null);
      setAutoSettings(null);
      return;
    }

    // Only show countdown when this order is still eligible for backend auto-action.
    if (!showCountdown || order?.auto_actioned) return;

    AsyncStorage.getItem('restaurant_code').then(async code => {
      if (!code) return;
      try {
        const res = await fetch(`${BACKEND_URL}/auto-settings/${code}`);
        const result = await res.json();
        if (result.success && result.settings.auto_action !== 'disabled') {
          setAutoSettings(result.settings);
          const waitSeconds = Math.max(1, Number(result.settings.wait_minutes || 5) * 60);
          const receivedRaw = order?.received_at || order?.timestamp || order?.date_created;
          const receivedMs = typeof receivedRaw === 'number'
            ? receivedRaw
            : (receivedRaw ? new Date(String(receivedRaw).replace(' ', 'T')).getTime() : NaN);
          const elapsedSeconds = Number.isFinite(receivedMs)
            ? Math.max(0, Math.floor((Date.now() - receivedMs) / 1000))
            : 0;
          setCountdown(Math.max(0, waitSeconds - elapsedSeconds));
        }
      } catch (e) {}
    });
  }, [visible, showCountdown, order?.order_id, order?.received_at, order?.timestamp, order?.auto_actioned]);

  // Countdown timer — display only. Reaching zero is NOT proof that the server
  // auto-action succeeded. Keep the modal/Review state until the backend confirms
  // auto_actioned; otherwise a slow/failed server action could silently hide an order.
  useEffect(() => {
    if (countdown === null) return;

    if (countdown > 0) {
      const timer = setTimeout(() => setCountdown(c => (c !== null ? Math.max(0, c - 1) : null)), 1000);
      return () => clearTimeout(timer);
    }

    let cancelled = false;
    const verifyAutoAction = async () => {
      try {
        const code = await AsyncStorage.getItem('restaurant_code') || '';
        const orderId = Number(order?.order_id);
        if (!code || !Number.isFinite(orderId)) return;
        const res = await fetch(`${BACKEND_URL}/check-auto-actioned/${code}/${orderId}`);
        const result = await res.json();
        if (cancelled || !result?.auto_actioned) return;

        const stored = await AsyncStorage.getItem('pending_decision');
        const list: number[] = stored ? JSON.parse(stored) : [];
        await AsyncStorage.setItem(
          'pending_decision',
          JSON.stringify(list.filter(id => id !== orderId))
        );
        await AsyncStorage.setItem('pending_decision_refresh', String(Date.now()));
        onClose();
      } catch (e) {
        // Keep the modal visible; live reconciliation will retry/resolve it.
      }
    };

    void verifyAutoAction();
    const timer = setInterval(() => void verifyAutoAction(), 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [countdown, order?.order_id, onClose]);

  // Reset on open
  useEffect(() => {
    if (visible) {
      setStep('main');
      setSelectedTime(null);
      setSelectedReason('');
      setCustomReason('');
    }
  }, [visible]);

  

  const removePendingDecision = async (orderId: number, refreshDelayMs = 0) => {
    try {
      const stored = await AsyncStorage.getItem('pending_decision');
      const list: number[] = stored ? JSON.parse(stored) : [];
      await AsyncStorage.setItem('pending_decision', JSON.stringify(list.filter(id => id !== orderId)));
      onDecisionMade?.(orderId);

      const signalRefresh = async () => {
        await AsyncStorage.setItem(
          'pending_decision_refresh',
          String(Date.now())
        );
      };

      if (refreshDelayMs > 0) {
        setTimeout(() => {
          void signalRefresh();
        }, refreshDelayMs);
      } else {
        await signalRefresh();
      }
    } catch (e) {}
  };

  if (!order) return null;

  const handleConfirmAcceptWithTime = async (acceptTime: string) => {
    setLoading(true);
    setCountdown(null);
    try {
      const code = await AsyncStorage.getItem('restaurant_code') || '';

      // Start the existing print timer before WordPress synchronization.
      // Keep the original print delay unchanged.
      setTimeout(() => {
        const isScheduledTime = acceptTime.includes('—') || acceptTime.includes(':');
        if (isScheduledTime) {
          printOrder(order, undefined, false, '', acceptTime).catch(() => {});
          scheduleScheduledOrderReminder(order, acceptTime, t).catch(() => {});
        } else {
          const mins = parseInt(acceptTime);
          printOrder(order, isNaN(mins) ? 30 : mins).catch(() => {});
        }
      }, 300);
      // Owner took control — cancel backend auto-action
      fetch(`${BACKEND_URL}/cancel-auto-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurant_code: code, order_id: order.order_id, secret: 'foodup2026' }),
      }).catch(() => {});
      const restaurantProfile = await fetch(`${BACKEND_URL}/restaurant-profile/${code}`).then(r => r.json()).catch(() => ({}));
      const website = restaurantProfile?.profile?.website;
      if (!website) {
        throw new Error('Restaurant website is not configured');
      }
      if (website) {
        const baseUrl = website.startsWith('http') ? website : `https://${website}`;
        await postWordPressDecision(
          baseUrl + '/wp-json/foodup/v1/order-accepted',
          {
            secret: 'foodup2026',
            order_id: order.order_id,
            accepted_time: acceptTime,
          }
        );

      // WooCommerce confirmed completed; now record FoodUp acceptance.
      await postDecisionAction('/accepted-time', {
        restaurant_code: code,
        order_id: order.order_id,
        accepted_time: acceptTime,
        accepted_at: new Date().toISOString(),
        status: 'accepted',
      });
      }
      await removePendingDecision(order.order_id, 7000);
      setLoading(false);
      onClose();
    } catch (e) {
      setLoading(false);
    }
  };

  const handleConfirmRejectWithReason = async (reason: string) => {
    setLoading(true);
    setCountdown(null);
    try {
      const code = await AsyncStorage.getItem('restaurant_code') || '';
      // Owner took control — cancel backend auto-action
      fetch(`${BACKEND_URL}/cancel-auto-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurant_code: code, order_id: order.order_id, secret: 'foodup2026' }),
      }).catch(() => {});
      // Guard against backend race — mirrors accepted_time protection for accept
      const restaurantProfile = await fetch(`${BACKEND_URL}/restaurant-profile/${code}`).then(r => r.json()).catch(() => ({}));
      const website = restaurantProfile?.profile?.website;
      if (!website) {
        throw new Error('Restaurant website is not configured');
      }
      if (website) {
        const baseUrl = website.startsWith('http') ? website : `https://${website}`;
        await postWordPressDecision(
          baseUrl + '/wp-json/foodup/v1/order-rejected',
          {
            secret: 'foodup2026',
            order_id: order.order_id,
            reason,
          }
        );

      // WooCommerce confirmed cancelled; now record FoodUp rejection.
      await postDecisionAction('/rejected-time', { restaurant_code: code, order_id: order.order_id, secret: 'foodup2026' });
      }
      await postDecisionAction('/status-update', {
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
      });
      await removePendingDecision(order.order_id);
      setLoading(false);
      onClose();
      setTimeout(() => {
        printOrder(order, undefined, true, reason).catch(() => {});
      }, 2000);
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
      // Owner took control — cancel backend auto-action
      fetch(`${BACKEND_URL}/cancel-auto-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurant_code: code, order_id: order.order_id, secret: 'foodup2026' }),
      }).catch(() => {});
      const acceptedTime = isScheduled ? `${scheduledTime} — ${scheduledDate}` : `${selectedTime} ${t.minutes}`;

      // Start the existing print timer before WordPress synchronization.
      // Keep the original print delay unchanged.
      setTimeout(() => {
        if (isScheduled) {
          printOrder(order, undefined, false, '', `${scheduledTime} — ${scheduledDate}`).catch(() => {});
          scheduleScheduledOrderReminder(order, `${scheduledTime} — ${scheduledDate}`, t).catch(() => {});
        } else {
          printOrder(order, selectedTime).catch(() => {});
        }
      }, 2000);
      const restaurantProfile = await fetch(`${BACKEND_URL}/restaurant-profile/${code}`).then(r => r.json()).catch(() => ({}));
      const website = restaurantProfile?.profile?.website;
      if (!website) {
        throw new Error('Restaurant website is not configured');
      }
      if (website) {
        const baseUrl = website.startsWith('http') ? website : `https://${website}`;
        await postWordPressDecision(
          baseUrl + '/wp-json/foodup/v1/order-accepted',
          {
            secret: 'foodup2026',
            order_id: order.order_id,
            accepted_time: acceptedTime,
          }
        );

      // WooCommerce confirmed completed; now record FoodUp acceptance.
      await postDecisionAction('/accepted-time', {
        restaurant_code: code,
        order_id: order.order_id,
        accepted_time: acceptedTime,
        accepted_at: new Date().toISOString(),
        status: 'accepted',
      });
      }
      await removePendingDecision(order.order_id, 7000);
      setLoading(false);
      onClose();
    } catch (e) {
      setLoading(false);
      onClose();
    }
  };

  const handleConfirmReject = async () => {
    const reason = selectedReason === t.other ? customReason : selectedReason;
    if (!reason) return;
    setLoading(true);
    setCountdown(null);
    try {
      const code = await AsyncStorage.getItem('restaurant_code') || '';
      // Owner took control — cancel backend auto-action
      fetch(`${BACKEND_URL}/cancel-auto-action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurant_code: code, order_id: order.order_id, secret: 'foodup2026' }),
      }).catch(() => {});
      // Guard against backend race — mirrors accepted_time protection for accept
      const restaurantProfile = await fetch(`${BACKEND_URL}/restaurant-profile/${code}`).then(r => r.json()).catch(() => ({}));
      const website = restaurantProfile?.profile?.website;
      if (!website) {
        throw new Error('Restaurant website is not configured');
      }
      if (website) {
        const baseUrl = website.startsWith('http') ? website : `https://${website}`;
        await postWordPressDecision(
          baseUrl + '/wp-json/foodup/v1/order-rejected',
          {
            secret: 'foodup2026',
            order_id: order.order_id,
            reason,
          }
        );

      // WooCommerce confirmed cancelled; now record FoodUp rejection.
      await postDecisionAction('/rejected-time', { restaurant_code: code, order_id: order.order_id, secret: 'foodup2026' });

      const stored = await AsyncStorage.getItem('foodup_orders');
      const existing = stored ? JSON.parse(stored) : [];
      const updated = existing.map((o: any) =>
        o.order_id === order.order_id ? { ...o, status: 'cancelled' } : o
      );
      await AsyncStorage.setItem('foodup_orders', JSON.stringify(updated));
      }
      await postDecisionAction('/status-update', {
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
      });
      await removePendingDecision(order.order_id);
      setLoading(false);
      onClose();
      setTimeout(() => {
        printOrder(order, undefined, true, reason).catch(() => {});
      }, 2000);
    } catch (e) {
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
                <Text style={{ fontSize: 20, fontWeight: '700', color: '#111' }}>{t.orderNumber} #{order.order_id}</Text>
                {countdown !== null && autoSettings && showCountdown && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Ionicons name="hourglass-outline" size={18} color={countdown < 60 ? '#e74c3c' : '#f39c12'} />
                    <Text style={{ fontSize: 18, fontWeight: '900', color: countdown < 60 ? '#e74c3c' : '#f39c12' }}>
                      {Math.floor(countdown / 60)}:{String(countdown % 60).padStart(2, '0')}
                    </Text>
                  </View>
                )}
              </View>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                <View style={{ gap: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Ionicons name="person-outline" size={13} color="#999" />
                    <Text style={{ fontSize: 14, color: '#999' }}>{order.customer_name}</Text>
                  </View>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Ionicons name="cash-outline" size={13} color="#999" />
                    <Text style={{ fontSize: 14, color: '#999' }}>{order.currency} {order.total}</Text>
                  </View>
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
                  {countdown !== null && autoSettings && showCountdown && (
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
              {isScheduled && order.orderable_order_date ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                  <Ionicons name="time-outline" size={14} color="#8B38CB" />
                  <Text style={{ fontSize: 13, color: '#8B38CB' }}>{scheduledTime} — {scheduledDate}</Text>
                </View>
              ) : null}
              {order.shipping_address ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                  <Ionicons name="location-outline" size={14} color="#8B38CB" />
                  <Text style={{ fontSize: 13, color: '#8B38CB', flex: 1 }}>{formatAddress(order.shipping_address)}</Text>
                </View>
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
                    {times.map(time => (
                      <TouchableOpacity
                        key={time}
                        onPress={() => setSelectedTime(time)}
                        style={{
                          flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                          paddingVertical: 14, paddingHorizontal: 16, borderRadius: 12,
                          backgroundColor: selectedTime === time ? '#f0fdf4' : '#F5F5F5',
                          marginBottom: 8,
                          borderWidth: selectedTime === time ? 1.5 : 0,
                          borderColor: selectedTime === time ? '#2ecc71' : 'transparent',
                        }}
                      >
                        <Text style={{ fontSize: 15, fontWeight: '600', color: '#111' }}>{time} {t.minutes}</Text>
                        {selectedTime === time && <Ionicons name="checkmark-circle" size={20} color="#2ecc71" />}
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
              <TouchableOpacity
                style={{ backgroundColor: (isScheduled || selectedTime) ? '#111' : '#ccc', borderRadius: 14, padding: 16, alignItems: 'center', flexDirection: 'row', justifyContent: 'center', gap: 8 }}
                onPress={() => isScheduled ? handleConfirmAcceptWithTime(`${scheduledTime} — ${scheduledDate}`) : handleConfirmAccept()}
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
                    style={{ paddingHorizontal: 12, paddingVertical: 12, borderRadius: 12, backgroundColor: selectedReason === reason ? '#e74c3c' : '#F5F5F5' }}
                  >
                    <Text style={{ fontSize: 15, fontWeight: '600', color: selectedReason === reason ? '#fff' : '#111' }}>{reason}</Text>
                  </TouchableOpacity>
                ))}
              </View>
              {selectedReason === t.other && (
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
                disabled={!selectedReason || loading || (selectedReason === t.other && !customReason)}
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
