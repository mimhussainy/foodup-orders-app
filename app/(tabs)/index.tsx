import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import * as Notifications from 'expo-notifications';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  AppState,
  BackHandler,
  FlatList,
  Image,
  InteractionManager,
  Linking,
  Modal,
  Platform,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
import CustomAlert from '../../components/CustomAlert';
import { printOrder } from '../../lib/printer';
import { useLanguage } from '../../lib/useLanguage';

interface OrderAddon {
  label: string;
  value: string;
}

interface OrderItem {
  name: string;
  quantity: number;
  total: number;
  addons: OrderAddon[];
}

interface Order {
  order_id: number;
  customer_name: string;
  customer_email: string;
  customer_phone: string;
  total: string;
  currency: string;
  status: string;
  event_type: string;
  items: OrderItem[];
  payment_method: string;
  note: string;
  date: string;
  timestamp: number;
  shipping_method: string;
  shipping_address: string;
  restaurant_code?: string;
  orderable_order_date?: string;
  orderable_order_time?: string;
  date_created?: string;
}
function ScheduledCountdown({ scheduledMs, at }: { scheduledMs: number; at: string }) {
  const [now, setNow] = useState(Date.now());
  const { t } = useLanguage();

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const remainingMs = scheduledMs - now;
  const isOverdue = remainingMs < 0;
  const absMs = Math.abs(remainingMs);
  const hours = Math.floor(absMs / 3600000);
  const mins = Math.floor((absMs % 3600000) / 60000);
  const secs = Math.floor((absMs % 60000) / 1000);
  const barColor = isOverdue ? '#e74c3c' : remainingMs < 30 * 60000 ? '#f39c12' : '#8B38CB';
  const showBar = isOverdue || remainingMs <= 3600000;
  const countdownProgress = Math.max(0, Math.min(1, remainingMs / 3600000));
  
  const label = isOverdue ? `${mins}m ${secs}s ${t.overdue || 'overdue'}` : hours >= 1 ? `${hours}h ${mins}m ${t.remaining || 'remaining'}` : `${mins}m ${secs}s ${t.remaining || 'remaining'}`;

  return (
    <View style={{ marginTop: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons name="time-outline" size={12} color={barColor} />
          <Text style={{ fontSize: 12, fontWeight: '700', color: barColor }}>{label}</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons name="calendar-outline" size={13} color="#8B38CB" />
          <Text style={{ fontSize: 12, fontWeight: '600', color: '#8B38CB' }}>
          {(() => {
            const parts = at.split('—');
            if (parts.length < 2) return at;
            const timePart = parts[0].trim();
            const datePart = parts[1].trim();
            const dateSections = datePart.split('/');
            if (dateSections.length < 3) return at;
            const scheduledDate = new Date(`${dateSections[2]}-${dateSections[1]}-${dateSections[0]}`);
            const today = new Date();
            const isToday = scheduledDate.toDateString() === today.toDateString();
            return isToday ? timePart : at;
          })()}
          </Text>
        </View>
      </View>
      {showBar && (
        <View style={{ height: 4, backgroundColor: '#F0F0F0', borderRadius: 2, overflow: 'hidden' }}>
          <View style={{ height: 4, width: `${countdownProgress * 100}%`, backgroundColor: barColor, borderRadius: 2 }} />
        </View>
      )}
    </View>
  );
}
function OrderCountdown({ accepted_at, accepted_time }: { accepted_at: string; accepted_time: string }) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [totalSeconds, setTotalSeconds] = useState<number>(0);
  const { t } = useLanguage();

  useEffect(() => {
    if (!accepted_at || !accepted_time) return;
    // If accepted_time contains ':' and '—' it's a scheduled time string, not minutes
    if (accepted_time.includes('—') || accepted_time.includes(':')) return;
    const minutes = parseInt(accepted_time.replace(/[^0-9]/g, ''));
    if (isNaN(minutes)) return;
    const acceptedDate = new Date(accepted_at);
    if (isNaN(acceptedDate.getTime())) return;
    const deadlineMs = acceptedDate.getTime() + minutes * 60 * 1000;
    const total = minutes * 60;
    setTotalSeconds(total);
    const update = () => {
      const diff = Math.floor((deadlineMs - Date.now()) / 1000);
      setRemaining(diff);
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, [accepted_at, accepted_time]);

  if (remaining === null || totalSeconds === 0) return null;

  const mins = Math.floor(Math.abs(remaining) / 60);
  const secs = Math.abs(remaining) % 60;
  const isLate = remaining < 0;
  const percentage = remaining / totalSeconds;
  const color = isLate ? '#e74c3c' : percentage < 0.25 ? '#e74c3c' : percentage < 0.50 ? '#f39c12' : '#2ecc71';
  const progress = Math.max(0, Math.min(1, remaining / totalSeconds));

  return (
    <View style={{ marginTop: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Ionicons name="hourglass-outline" size={13} color={color} />
          <Text style={{ fontSize: 12, fontWeight: '700', color }}>
            {isLate ? `${mins}m ${secs}s ${t.overdue || 'overdue'}` : `${mins}m ${secs}s ${t.remaining || 'remaining'}`}
          </Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
          <Ionicons name="checkmark-circle-outline" size={13} color="#8B38CB" />
          <Text style={{ fontSize: 12, fontWeight: '600', color: '#8B38CB' }}>
            {accepted_time.replace('Minutes', 'mins')}
          </Text>
          {(() => {
            try {
              const deadlineDate = new Date(new Date(accepted_at).getTime() + parseInt(accepted_time.replace(/[^0-9]/g, '')) * 60000);
              const hours = String(deadlineDate.getHours()).padStart(2, '0');
              const minutes = String(deadlineDate.getMinutes()).padStart(2, '0');
              return (
                <>
                  <Ionicons name="flash-outline" size={13} color="#8B38CB" />
                  <Text style={{ fontSize: 12, fontWeight: '600', color: '#8B38CB' }}>{hours}:{minutes}</Text>
                </>
              );
            } catch (e) { return null; }
          })()}
        </View>
      </View>
      <View style={{ height: 4, backgroundColor: '#F0F0F0', borderRadius: 2, overflow: 'hidden' }}>
        <View style={{ height: 4, width: `${progress * 100}%`, backgroundColor: color, borderRadius: 2 }} />
      </View>
    </View>
  );
}
function getStatusColor(status: string) {
  switch (status) {
    case 'processing': return '#2ecc71';
    case 'completed': return '#3498db';
    case 'cancelled': return '#e74c3c';
    case 'pending': return '#f39c12';
    case 'on-hold': return '#9b59b6';
    default: return '#95a5a6';
  }
}

function getStatusLabel(status: string, t: any) {
  switch (status) {
    case 'processing': return t.processing;
    case 'completed': return t.completed;
    case 'cancelled': return t.cancelled;
    case 'pending': return t.pending;
    case 'on-hold': return t.onHold;
    default: return status;
  }
}

function getDeliveryStatusColor(claim: any) {
  if (!claim) return '#f39c12';
  const status = typeof claim === 'string' ? 'delivering' : claim.status;
  switch (status) {
    case 'delivered': return '#2fc053';
    case 'delivering': return '#16a085';
    case 'in_bag': return '#2980b9';
    default: return '#f39c12';
  }
}

function getDeliveryStatusLabel(claim: any, item: any, t: any) {
  if (item.status === 'cancelled') return t.cancelled;
  if (!claim) return t.newOrder;
  const status = typeof claim === 'string' ? 'delivering' : claim.status;
  const isPickup = item.shipping_method === 'Abholung' || item.shipping_method?.toLowerCase().includes('pickup');
  switch (status) {
    case 'delivered': return isPickup ? t.pickedUp : t.delivered;
    case 'delivering': return t.delivering;
    case 'in_bag': return t.inBag;
    default: return t.newOrder;
  }
}

function getDateLabel(timestamp: number, t: any) {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return t.today;
  if (date.toDateString() === yesterday.toDateString()) return t.yesterday;
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
}

function groupOrdersByDate(orders: Order[], t: any) {
  const groups: { [key: string]: Order[] } = {};
  orders.forEach(order => {
    const label = getDateLabel(order.timestamp, t);
    if (!groups[label]) groups[label] = [];
    groups[label].push(order);
  });
  return Object.keys(groups).map(title => ({ title, data: groups[title] }));
}

const BACKEND_URL = 'https://foodup-order-alerts-backend.onrender.com';
const STORAGE_KEY = 'foodup_orders';

async function scheduleScheduledOrderReminder(order: any, acceptTime: string) {
  try {
    const parts = acceptTime.split('—');
    if (parts.length < 2) return;
    const timePart = parts[0].trim();
    const datePart = parts[1].trim().split('/');
    if (datePart.length < 3) return;
    const scheduledMs = new Date(`${datePart[2]}-${datePart[1]}-${datePart[0]}T${timePart}:00`).getTime();
    const reminderMs = scheduledMs - 30 * 60 * 1000;
    const now = Date.now();
    if (reminderMs <= now) return; // already past 30 min mark
    const secondsUntilReminder = Math.floor((reminderMs - now) / 1000);
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '⏰ Scheduled Order Reminder',
        body: `Order #${order.order_id} for ${order.customer_name} is due in 30 minutes! (${timePart})`,
        sound: true,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: secondsUntilReminder,
      },
    });
  } catch (e) {
    console.log('scheduleScheduledOrderReminder error:', e);
  }
}

function AcceptRejectModal({ order, visible, onClose }: { order: Order | null, visible: boolean, onClose: () => void }) {
  const [step, setStep] = useState<'main' | 'accept' | 'reject'>('main');
  const [selectedTime, setSelectedTime] = useState<number | null>(null);
  const [selectedReason, setSelectedReason] = useState<string>('');
  const [customReason, setCustomReason] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [autoSettings, setAutoSettings] = useState<any>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const { t } = useLanguage();

  const times = [15, 20, 25, 30, 45, 60];
  const reasons = [t.tooBusy, t.restaurantClosed, t.outOfStock, t.other];
  const isScheduled = order ? (
    !!order.orderable_order_time &&
    order.orderable_order_time.trim() !== '' &&
    !order.orderable_order_time.toLowerCase().includes('as soon as possible') &&
    !order.orderable_order_time.toLowerCase().includes('asap') &&
    !order.orderable_order_time.includes('(')
  ) : false;
  const scheduledTime = isScheduled ? order?.orderable_order_time?.replace(/\s*\(.*?\)\s*/g, '').trim() : '';
  const scheduledDate = isScheduled ? order?.orderable_order_date : '';
  console.log('=== isScheduled:', isScheduled, 'time:', order?.orderable_order_time, 'date:', order?.orderable_order_date);

  useEffect(() => {
    if (!visible) {
      setCountdown(null);
      setAutoSettings(null);
      return;
    }
    // Fetch auto settings
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
      // Auto action time!
      handleAutoAction();
      return;
    }
    const timer = setTimeout(() => setCountdown(c => (c !== null ? c - 1 : null)), 1000);
    return () => clearTimeout(timer);
  }, [countdown]);

  const handleAutoAction = async () => {
    if (!order || !autoSettings) return;
    if (autoSettings.auto_action === 'accept') {
      const acceptTime = isScheduled ? `${scheduledTime} — ${scheduledDate}` : autoSettings.accept_time;
      await handleConfirmAcceptWithTime(acceptTime);
    } else if (autoSettings.auto_action === 'reject') {
      await handleConfirmRejectWithReason(autoSettings.reject_reason);
    }
  };

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
    console.log('=== handleConfirmAcceptWithTime called with:', acceptTime);
    console.log('=== includes —:', acceptTime.includes('—'), 'includes ::', acceptTime.includes(':'));
    setLoading(true);
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
      const restaurantProfile = await fetch(`${BACKEND_URL}/restaurant-profile/${code}`).then(r => r.json()).catch(() => ({}));
      const website = restaurantProfile?.profile?.website;
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
      InteractionManager.runAfterInteractions(() => {
        setTimeout(() => {
          const isScheduledTime = acceptTime.includes('—') || acceptTime.includes(':');
          if (isScheduledTime) {
            printOrder(order, undefined, false, '', acceptTime).catch(() => {});
            scheduleScheduledOrderReminder(order, acceptTime).catch(() => {});
          } else {
            const mins = parseInt(acceptTime);
            printOrder(order, isNaN(mins) ? 30 : mins).catch(() => {});
          }
        }, 500);
      });
    } catch (e) {
      setLoading(false);
    }
  };

  const handleConfirmRejectWithReason = async (reason: string) => {
    setLoading(true);
    try {
      const code = await AsyncStorage.getItem('restaurant_code') || '';
      const restaurantProfile = await fetch(`${BACKEND_URL}/restaurant-profile/${code}`).then(r => r.json()).catch(() => ({}));
      const website = restaurantProfile?.profile?.website;
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
      InteractionManager.runAfterInteractions(() => {
        setTimeout(() => {
          printOrder(order, undefined, true, reason).catch(() => {});
        }, 500);
      });
    } catch (e) {
      setLoading(false);
      onClose();
    }
  };

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
          accepted_time: isScheduled ? `${scheduledTime} — ${scheduledDate}` : `${selectedTime} Minutes`,
          accepted_at: new Date().toISOString(),
          status: 'accepted',
        }),
      }).catch(e => console.log('accepted-time error:', e));

      // Update WP status and send email
      const restaurantProfile = await fetch(`${BACKEND_URL}/restaurant-profile/${code}`).then(r => r.json()).catch((err) => { console.log('=== PROFILE FETCH ERROR:', err); return {}; });
      const website = restaurantProfile?.profile?.website;
      console.log('=== WEBSITE:', website, 'PROFILE:', JSON.stringify(restaurantProfile));
      fetch(`${BACKEND_URL}/log`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: `ACCEPT DEBUG: code=${code} website=${website} profile=${JSON.stringify(restaurantProfile)}` }),
      }).catch(() => {});
      if (website) {
        const baseUrl = website.startsWith('http') ? website : `https://${website}`;
        console.log('=== CALLING WP:', baseUrl + '/wp-json/foodup/v1/order-accepted');
        fetch(`${baseUrl}/wp-json/foodup/v1/order-accepted`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            secret: 'foodup2026',
            order_id: order.order_id,
            accepted_time: isScheduled ? `${scheduledTime} — ${scheduledDate}` : `${selectedTime} Minutes`,
          }),
        }).catch(e => console.log('wp accept error:', e));
      }

      setLoading(false);
      onClose();
      InteractionManager.runAfterInteractions(() => {
        setTimeout(() => {
          if (isScheduled) {
            printOrder(order, undefined, false, '', `${scheduledTime} — ${scheduledDate}`).catch(e => console.log('print accept error:', e));
            scheduleScheduledOrderReminder(order, `${scheduledTime} — ${scheduledDate}`).catch(() => {});
          } else {
            printOrder(order, selectedTime).catch(e => console.log('print accept error:', e));
          }
        }, 500);
      });
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
      // Update WP status and send email
      const restaurantProfileR = await fetch(`${BACKEND_URL}/restaurant-profile/${code}`).then(r => r.json()).catch(() => ({}));
      const websiteR = restaurantProfileR?.profile?.website;
      if (websiteR) {
        const baseUrlR = websiteR.startsWith('http') ? websiteR : `https://${websiteR}`;
        fetch(`${baseUrlR}/wp-json/foodup/v1/order-rejected`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            secret: 'foodup2026',
            order_id: order.order_id,
            reason: reason,
          }),
        }).catch(e => console.log('wp reject error:', e));
      }

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
      InteractionManager.runAfterInteractions(() => {
        setTimeout(() => {
          printOrder(order, undefined, true, reason).catch(e => console.log('print reject error:', e));
        }, 500);
      });
    } catch (e) {
      console.log('reject error:', e);
      setLoading(false);
      onClose();
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={() => {}}>
      <View style={{
        flex: 1,
        backgroundColor: 'rgba(0,0,0,0.5)',
        justifyContent: 'flex-end',
      }}>
        <View style={{
          backgroundColor: '#fff',
          borderTopLeftRadius: 24,
          borderTopRightRadius: 24,
          padding: 24,
          paddingBottom: 80,
        }}>
          {step === 'main' && (
            <>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                <Text style={{ fontSize: 20, fontWeight: '700', color: '#111' }}>
                  Order #{order.order_id}
                </Text>
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
              {isScheduled && order.orderable_order_date ? (
                <Text style={{ fontSize: 13, color: '#8B38CB', marginBottom: 4 }}>
                  🕐 {scheduledTime} — {scheduledDate}
                </Text>
              ) : null}
              {order.shipping_address ? (
                <Text style={{ fontSize: 13, color: '#8B38CB', marginBottom: 12 }}>
                  📍 {order.shipping_address}
                </Text>
              ) : null}
              <View style={{ backgroundColor: '#F7F7F7', borderRadius: 12, padding: 12, marginBottom: 16, maxHeight: 160 }}>
                <ScrollView nestedScrollEnabled>
                  {(order.items || []).map((item: any, i: number) => (
                    <View key={i} style={{ marginBottom: 6 }}>
                      <Text style={{ fontSize: 15, fontWeight: '700', color: '#111' }}>
                        {item.quantity}x {item.name}
                      </Text>
                      {item.addons && item.addons.length > 0 && item.addons.map((addon: any, j: number) => (
                        <Text key={j} style={{ fontSize: 13, color: '#666', paddingLeft: 8 }}>
                          ↳ {addon.value}
                        </Text>
                      ))}
                    </View>
                  ))}
                </ScrollView>
              </View>
              <TouchableOpacity
                style={{
                  backgroundColor: '#2ecc71',
                  borderRadius: 14,
                  padding: 16,
                  alignItems: 'center',
                  marginBottom: 12,
                  flexDirection: 'row',
                  justifyContent: 'center',
                  gap: 8,
                }}
                onPress={() => setStep('accept')}
              >
                <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>{t.acceptOrder}</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{
                  backgroundColor: '#e74c3c',
                  borderRadius: 14,
                  padding: 16,
                  alignItems: 'center',
                  flexDirection: 'row',
                  justifyContent: 'center',
                  gap: 8,
                }}
                onPress={() => setStep('reject')}
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
                  <Text style={{ fontSize: 18, fontWeight: '700', color: '#111', marginBottom: 8 }}>
                    {t.scheduledOrder}
                  </Text>
                  <View style={{ backgroundColor: '#f5eeff', borderRadius: 12, padding: 16, marginBottom: 24 }}>
                    <Text style={{ fontSize: 14, color: '#8B38CB', fontWeight: '600', marginBottom: 4 }}>🕐 {t.scheduledConfirm}</Text>
                    <Text style={{ fontSize: 22, fontWeight: '900', color: '#8B38CB' }}>{scheduledTime} — {scheduledDate}</Text>
                  </View>
                </>
              ) : (
                <>
                  <Text style={{ fontSize: 18, fontWeight: '700', color: '#111', marginBottom: 16 }}>
                    {t.selectPreparationTime}
                  </Text>
                  <View style={{ marginBottom: 24 }}>
                    {times.map(time => (
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
                        <Text style={{ fontSize: 16, fontWeight: '600', color: '#111' }}>{time} {t.minutes}</Text>
                        {selectedTime === time && (
                          <Ionicons name="checkmark-circle" size={20} color="#2ecc71" />
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                </>
              )}
              <TouchableOpacity
                style={{
                  backgroundColor: (isScheduled || selectedTime) ? '#111' : '#ccc',
                  borderRadius: 14,
                  padding: 16,
                  alignItems: 'center',
                  flexDirection: 'row',
                  justifyContent: 'center',
                  gap: 8,
                }}
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
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>
                  {loading ? t.printing : t.confirmAndPrint}
                </Text>
              </TouchableOpacity>
            </>
          )}

          {step === 'reject' && (
            <>
              <TouchableOpacity onPress={() => setStep('main')} style={{ marginBottom: 16 }}>
                <Text style={{ color: '#007AFF', fontSize: 14 }}>{t.back}</Text>
              </TouchableOpacity>
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#111', marginBottom: 16 }}>
                {t.selectRejectionReason}
              </Text>
              <View style={{ gap: 10, marginBottom: 16 }}>
                {reasons.map(reason => (
                  <TouchableOpacity
                    key={reason}
                    onPress={() => setSelectedReason(reason)}
                    style={{
                      paddingHorizontal: 12,
                      paddingVertical: 12,
                      borderRadius: 12,
                      backgroundColor: selectedReason === reason ? '#e74c3c' : '#F5F5F5',
                    }}
                  >
                    <Text style={{
                      fontSize: 15,
                      fontWeight: '600',
                      color: selectedReason === reason ? '#fff' : '#111',
                    }}>
                      {reason}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {selectedReason === 'Other' && (
                <TextInput
                  style={{
                    borderWidth: 1,
                    borderColor: '#E8E8E8',
                    borderRadius: 12,
                    padding: 14,
                    fontSize: 15,
                    color: '#111',
                    marginBottom: 16,
                  }}
                  placeholder={t.enterReason}
                  placeholderTextColor="#C0C0C0"
                  value={customReason}
                  onChangeText={setCustomReason}
                />
              )}
              <TouchableOpacity
                style={{
                  backgroundColor: selectedReason ? '#e74c3c' : '#1f1919',
                  borderRadius: 14,
                  padding: 16,
                  alignItems: 'center',
                  flexDirection: 'row',
                  justifyContent: 'center',
                  gap: 8,
                }}
                onPress={handleConfirmReject}
                disabled={!selectedReason || loading || (selectedReason === 'Other' && !customReason)}
              >
                <Ionicons name="print-outline" size={20} color="#fff" />
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>
                  {loading ? t.printing : t.confirmAndPrint}
                </Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}



export default function OrdersScreen() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null); // kept for compatibility
  const [refreshing, setRefreshing] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [claims, setClaims] = useState<{ [key: string]: any }>({});
const [acceptedTimes, setAcceptedTimes] = useState<{ [key: string]: any }>({});
const [filter, setFilter] = useState<string>('all');
const [search, setSearch] = useState<string>('');
const [acceptRejectOrder, setAcceptRejectOrder] = useState<Order | null>(null);
const [showAcceptReject, setShowAcceptReject] = useState(false);
const [pickupReadyOrders, setPickupReadyOrders] = useState<{[key: string]: boolean}>({});
const [storeIsOpen, setStoreIsOpen] = useState<boolean | null>(null);
const [alertConfig, setAlertConfig] = useState<{ visible: boolean; title: string; message: string; buttons: any[]; icon?: string; iconColor?: string }>({ visible: false, title: '', message: '', buttons: [] });
const [canPrint, setCanPrint] = useState(false);
const [autoPrintOrders, setAutoPrintOrders] = useState<{[key: string]: any}>({});
const pulseAnim = useRef(new Animated.Value(1)).current;

useEffect(() => {
  const animation = Animated.loop(
    Animated.sequence([
      Animated.timing(pulseAnim, { toValue: 0.8, duration: 800, useNativeDriver: true }),
      Animated.timing(pulseAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
    ])
  );
  animation.start();
  return () => animation.stop();
}, [selectedOrder]);
  const { t } = useLanguage();
  const router = useRouter();
  const listRef = useRef<any>(null);

  useEffect(() => {
    if (!selectedOrder) return;
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      setSelectedOrder(null);
      return true;
    });
    return () => backHandler.remove();
  }, [selectedOrder]);

  useFocusEffect(
    useCallback(() => {
      fetchOrdersFromBackend();
      fetchClaims();
      setTimeout(() => {
        try {
          listRef.current?.scrollToLocation({ 
            sectionIndex: 0, 
            itemIndex: 0, 
            animated: true,
            viewOffset: 0,
          });
        } catch (e) {
          try {
            listRef.current?.getScrollResponder()?.scrollTo({ y: 0, animated: true });
          } catch (e2) {}
        }
      }, 500);
    }, [])
  );

  useEffect(() => {
    AsyncStorage.getItem('user_role').then(r => {
      setRole(r);
    });
    fetchOrdersFromBackend();
    fetchClaims();
    fetchStoreStatus();
    checkPrintPermission();

    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        fetchOrdersFromBackend();
        fetchClaims();
        fetchStoreStatus();
        loadAutoPrintOrders();
      }
    });

    const claimsInterval = setInterval(() => fetchClaims(), 10000);
    const ordersInterval = setInterval(() => fetchOrdersFromBackend(), 30000);
    const storeInterval = setInterval(() => fetchStoreStatus(), 15000);
    const newOrderInterval = setInterval(async () => {
      if (Platform.OS !== 'ios') {
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
              // Check if already accepted
              const acceptedRes = await fetch(`${BACKEND_URL}/accepted-time/${code}/${latestOrder.order_id}`);
              const acceptedResult = await acceptedRes.json();
              if (acceptedResult.success && acceptedResult.accepted_time) return;
              const newOrder: Order = {
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
                date_created: latestOrder.date_created || '',
              };
              router.replace('/(tabs)');
            }
          }
        } catch (e) {}
      }
    }, 5000);

    return () => {
      appStateSubscription.remove();
      clearInterval(claimsInterval);
      clearInterval(ordersInterval);
      clearInterval(storeInterval);
      clearInterval(newOrderInterval);
    };
  }, []);

  const checkPrintPermission = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return false;
    try {
      const code = await AsyncStorage.getItem('restaurant_code') || '';
      const deviceId = Application.getAndroidId() || '';
      const res = await fetch(`${BACKEND_URL}/printer-device/${code}`);
      const result = await res.json();
      const allowed = result.success && result.device_id && result.device_id === deviceId;
      setCanPrint(allowed);
      await AsyncStorage.setItem('can_print', allowed ? 'true' : 'false');
      return allowed;
    } catch (e) {
      return false;
    }
  };

  const fetchStoreStatus = async () => {
    try {
      const code = await AsyncStorage.getItem('restaurant_code') || '';
      if (!code) return;
      const response = await fetch(`${BACKEND_URL}/store-status/${code}`);
      const result = await response.json();
      if (result.success) setStoreIsOpen(result.is_open);
    } catch (e) {}
  };
  const fetchClaims = async () => {
    try {
      const code = await AsyncStorage.getItem('restaurant_code') || '';
      if (!code) return;
      const response = await fetch(`${BACKEND_URL}/claims/${code}`);
      const result = await response.json();
      if (result.success) setClaims(result.claims);
    } catch (e) {}
  };

  const fetchAcceptedTimes = async (orderList: Order[]) => {
    try {
      const code = await AsyncStorage.getItem('restaurant_code') || '';
      if (!code) return;
      const processingOrders = orderList.filter(o => o.status !== 'cancelled');
      const times: { [key: string]: any } = {};
      await Promise.all(processingOrders.map(async (order) => {
        try {
          const res = await fetch(`${BACKEND_URL}/accepted-time/${code}/${order.order_id}`);
          const result = await res.json();
          if (result.success) {
            times[String(order.order_id)] = result;
          }
        } catch (e) {}
      }));
      setAcceptedTimes(times);
    } catch (e) {}
  };
  const fetchOrdersFromBackend = async () => {
    try {
      const code = await AsyncStorage.getItem('restaurant_code') || '';
      if (!code) return;
      const response = await fetch(`${BACKEND_URL}/orders/${code}`);
      const result = await response.json();
      if (result.success && result.orders.length > 0) {
        const backendOrders: Order[] = result.orders.map((o: any) => ({
          order_id: parseInt(o.order_id),
          customer_name: o.customer_name || '',
          customer_email: o.customer_email || '',
          customer_phone: o.customer_phone || '',
          total: String(o.total || ''),
          currency: o.currency || 'CHF',
          status: o.status || '',
          event_type: o.event_type || 'new_order',
          items: o.items || [],
          payment_method: o.payment_method || '',
          note: o.note || '',
          date: o.date_created ? new Date(o.date_created).toLocaleString() : new Date().toLocaleString(),
          timestamp: o.date_created ? new Date(o.date_created).getTime() : Date.now(),
          shipping_method: o.shipping?.method || '',
          shipping_address: o.shipping?.address || '',
          restaurant_code: o.restaurant_code || '',
          orderable_order_date: o.orderable_order_date || '',
          orderable_order_time: o.orderable_order_time || '',
          date_created: o.date_created || '',
        }));
        setOrders(prev => {
          // Start with backend orders as source of truth for status
          const merged = [...prev];
          backendOrders.forEach(bo => {
            const exists = merged.findIndex(o => o.order_id === bo.order_id);
            if (exists === -1) {
              merged.push(bo);
            } else {
              // Backend is always source of truth for status
              merged[exists] = { ...merged[exists], status: bo.status };
            }
          });
          merged.sort((a, b) => b.order_id - a.order_id);
          AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
          fetchAcceptedTimes(merged);
          return merged;
        });
      }
    } catch (e) {}
  };

  

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
  }, [orders]);

  useEffect(() => {
      const subscription = Notifications.addNotificationReceivedListener(notification => {
        const data = notification.request.content.data as any;
        const newOrder: Order = {
        order_id: parseInt(data.order_id),
        customer_name: data.customer_name,
        customer_email: data.customer_email || '',
        customer_phone: data.customer_phone || '',
        total: data.total,
        currency: data.currency,
        status: data.status,
        event_type: data.event_type || 'new_order',
        items: JSON.parse(data.items || '[]'),
        payment_method: data.payment_method,
        note: data.note,
        date: data.date_created ? new Date(data.date_created).toLocaleString() : new Date().toLocaleString(),
        timestamp: data.date_created ? new Date(data.date_created).getTime() : Date.now(),
        shipping_method: data.shipping_method || '',
        shipping_address: data.shipping_address || '',
        restaurant_code: data.restaurant_code || '',
        orderable_order_time: data.orderable_order_time || '',
        orderable_order_date: data.orderable_order_date || '',
        };

        if (data.event_type === 'status_update') {
          setOrders(prev => {
            const exists = prev.findIndex(o => o.order_id === newOrder.order_id);
            if (exists >= 0) {
              const updated = [...prev];
              updated[exists] = { ...updated[exists], status: data.status };
              return updated;
            }
            return prev;
          });
        } else {
          setOrders(prev => {
            const exists = prev.findIndex(o => o.order_id === newOrder.order_id);
            if (exists >= 0) {
              const updated = [...prev];
              updated[exists] = newOrder;
              return updated;
            }
            return [newOrder, ...prev];
          });
          
        }
      });
      return () => subscription.remove();
    }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchOrdersFromBackend();
    await fetchClaims();
    setTimeout(() => setRefreshing(false), 500);
  };

  const loadPickupReadyOrders = async () => {
    const stored = await AsyncStorage.getItem('pickup_ready_orders');
    if (stored) setPickupReadyOrders(JSON.parse(stored));
  };
  const loadAutoPrintOrders = async () => {
    const keys = await AsyncStorage.getAllKeys();
    const printKeys = keys.filter(k => k.startsWith('auto_print_'));
    const result: {[key: string]: any} = {};
    for (const key of printKeys) {
      const val = await AsyncStorage.getItem(key);
      if (val) {
        const orderId = key.replace('auto_print_', '');
        result[orderId] = JSON.parse(val);
      }
    }
    setAutoPrintOrders(result);
  };

  useEffect(() => {
    loadPickupReadyOrders();
    loadAutoPrintOrders();
  }, []);

  const getDeliveryStatus = (order: Order) => {
    const claim = claims[String(order.order_id)];
    if (order.status === 'cancelled') return 'cancelled';
    if (!claim) return 'new';
    const status = typeof claim === 'string' ? 'delivering' : claim.status;
    const isPickup = (() => { const m = (order.shipping_method || '').toLowerCase().trim(); return m.includes('abholung') || m.includes('abholen') || m.includes('pickup') || m.includes('pick up') || m.includes('local_pickup') || m.includes('orderable_pickup') || m.includes('takeaway'); })();
    if (status === 'delivered' && isPickup) return 'pickedUp';
    return status;
  };

  const isScheduledOrder = (o: Order) => {
    return !!o.orderable_order_time &&
      o.orderable_order_time.trim() !== '' &&
      !o.orderable_order_time.toLowerCase().includes('as soon as possible') &&
      !o.orderable_order_time.toLowerCase().includes('asap') &&
      !o.orderable_order_time.includes('(');
  };

  const filteredOrders = orders
    .filter(o => {
      if (filter === 'scheduled') return isScheduledOrder(o) && o.status !== 'cancelled';
      return filter === 'all' || getDeliveryStatus(o) === filter;
    })
    .filter(o => {
      if (!search.trim()) return true;
      const s = search.toLowerCase();
      return (
        String(o.order_id).includes(s) ||
        o.customer_name.toLowerCase().includes(s) ||
        o.customer_phone.toLowerCase().includes(s)
      );
    });
const sections = groupOrdersByDate(filteredOrders, t);

type FlatItem = { type: 'storeStatus' } | { type: 'searchBar' } | { type: 'filterTabs' } | { type: 'header'; title: string } | { type: 'order'; item: Order };

const flatData: FlatItem[] = [
  { type: 'storeStatus' },
  { type: 'searchBar' },
  { type: 'filterTabs' },
  ...sections.flatMap(section => [
    { type: 'header' as const, title: section.title },
    ...section.data.map(item => ({ type: 'order' as const, item })),
  ]),
];



  const filterCounts = {
    new: orders.filter(o => getDeliveryStatus(o) === 'new').length,
    scheduled: orders.filter(o => isScheduledOrder(o) && o.status !== 'cancelled').length,
    in_bag: orders.filter(o => getDeliveryStatus(o) === 'in_bag').length,
    delivering: orders.filter(o => getDeliveryStatus(o) === 'delivering').length,
    delivered: orders.filter(o => getDeliveryStatus(o) === 'delivered').length,
    pickedUp: orders.filter(o => getDeliveryStatus(o) === 'pickedUp').length,
    cancelled: orders.filter(o => getDeliveryStatus(o) === 'cancelled').length,
    all: orders.length,
  };

  if (role === 'delivery') return null;

  if (selectedOrder) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setSelectedOrder(null)} style={styles.backCircle}>
            <Ionicons name="chevron-back" size={20} color="#111" />
          </TouchableOpacity>
          <Image source={require('../../assets/images/logo.png')} style={styles.logo} resizeMode="contain" />
          {Platform.OS === 'android' && canPrint ? (
            <TouchableOpacity onPress={() => printOrder(selectedOrder)} style={styles.backCircle}>
              <Ionicons name="print-outline" size={20} color="#111" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={() => {
              const { Share } = require('react-native');
              Share.share({
                title: `Order #${selectedOrder.order_id}`,
                message: `Order #${selectedOrder.order_id}\nCustomer: ${selectedOrder.customer_name}\nPhone: ${selectedOrder.customer_phone}\nAddress: ${selectedOrder.shipping_address}\nTotal: ${selectedOrder.currency} ${selectedOrder.total}\nPayment: ${selectedOrder.payment_method}\nItems: ${selectedOrder.items.map((i: any) => `${i.quantity}x ${i.name}`).join(', ')}${selectedOrder.note ? `\nNote: ${selectedOrder.note}` : ''}`,
              });
            }} style={styles.backCircle}>
              <Ionicons name="share-outline" size={20} color="#111" />
            </TouchableOpacity>
          )}
        </View>
        <SafeAreaView style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.scrollContent}>
            <View style={[styles.section, { marginTop: 16, paddingTop: 14, paddingBottom: 14 }]}>

              {/* TOP ROW - same as card */}
              <View style={styles.orderTopRow}>
                <Text style={styles.orderId}>Order #{selectedOrder.order_id}</Text>
                <View style={[styles.statusPill, { backgroundColor: getDeliveryStatusColor(claims[String(selectedOrder.order_id)]) + '20' }]}>
                  <Text style={[styles.statusPillText, { color: getDeliveryStatusColor(claims[String(selectedOrder.order_id)]) }]}>
                    {getDeliveryStatusLabel(claims[String(selectedOrder.order_id)], selectedOrder, t)}
                  </Text>
                </View>
              </View>

              <View style={styles.divider} />

              {/* CUSTOMER + ORDER TYPE - same as card collapsed */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name="person-outline" size={16} color="#999" />
                  <Text style={styles.orderCustomer}>{selectedOrder.customer_name}</Text>
                </View>
                {selectedOrder.orderable_order_time ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                    <Ionicons name={isScheduledOrder(selectedOrder) ? 'calendar-outline' : 'flash-outline'} size={13} color={isScheduledOrder(selectedOrder) ? '#8B38CB' : '#f39c12'} />
                    <Text style={{ fontSize: 13, fontWeight: '700', color: isScheduledOrder(selectedOrder) ? '#8B38CB' : '#f39c12' }}>
                      {isScheduledOrder(selectedOrder) ? t.scheduled : t.asapShort}
                    </Text>
                  </View>
                ) : null}
              </View>

              {/* PRICE + PAYMENT - same as card collapsed */}
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                <View style={styles.orderMeta}>
                  <Ionicons name="cash-outline" size={14} color="#999" />
                  <Text style={styles.orderTotal}>{selectedOrder.currency} {selectedOrder.total}</Text>
                </View>
                {(() => {
                  const isCash = selectedOrder.payment_method?.toLowerCase().includes('bar') || selectedOrder.payment_method?.toLowerCase().includes('cash');
                  return (
                    <View style={styles.orderMeta}>
                      <Ionicons name={isCash ? 'cash-outline' : 'card-outline'} size={14} color={isCash ? '#e74c3c' : '#2ecc71'} />
                      <Text style={[styles.orderTotal, { color: isCash ? '#e74c3c' : '#2ecc71' }]}>{isCash ? t.notPaid : t.paidOnline}</Text>
                    </View>
                  );
                })()}
              </View>

              {/* COUNTDOWN - same as card collapsed */}
              {acceptedTimes[String(selectedOrder.order_id)] && (() => {
                const claim = claims[String(selectedOrder.order_id)];
                const status = claim ? (typeof claim === 'string' ? 'delivering' : claim.status) : 'new';
                const at = acceptedTimes[String(selectedOrder.order_id)].accepted_time || '';
                const isItemScheduled = at.includes('—') || (at.includes(':') && !at.includes('Minutes'));
                if (status === 'delivered') return null;
                if (isItemScheduled) {
                  const scheduledStr = at.split('—')[0].trim();
                  const scheduledDateStr = at.split('—')[1]?.trim();
                  const parts = scheduledDateStr?.split('/');
                  const scheduledMs = parts ? new Date(`${parts[2]}-${parts[1]}-${parts[0]}T${scheduledStr}:00`).getTime() : null;
                  if (!scheduledMs) return null;
                  return <ScheduledCountdown scheduledMs={scheduledMs} at={at} />;
                }
                return <OrderCountdown accepted_at={acceptedTimes[String(selectedOrder.order_id)].accepted_at} accepted_time={at} />;
              })()}

              {/* BOTTOM ROW - same as card collapsed */}
              {!(acceptedTimes[String(selectedOrder.order_id)] && (() => {
                const claim = claims[String(selectedOrder.order_id)];
                const status = claim ? (typeof claim === 'string' ? 'delivering' : claim.status) : 'new';
                return status !== 'delivered';
              })()) && <View style={[styles.divider, { marginBottom: 0 }]} />}
              <View style={styles.orderBottomRow}>
                {selectedOrder.shipping_method ? (
                  <View style={styles.orderMeta}>
                    <Ionicons name={selectedOrder.shipping_method === 'Abholung' ? 'bag-outline' : 'bicycle-outline'} size={14} color="#999" />
                    <Text style={styles.orderShipping}>{selectedOrder.shipping_method === 'Abholung' ? t.pickupLabel : selectedOrder.shipping_method === 'Lieferung' ? t.deliveryLabel : selectedOrder.shipping_method}</Text>
                  </View>
                ) : <View />}
                {claims[String(selectedOrder.order_id)] ? (
                  <View style={styles.orderMeta}>
                    {(() => {
                      const claim = claims[String(selectedOrder.order_id)];
                      const name = (() => { const raw = typeof claim === 'string' ? claim : claim.name; if (raw === 'Abgeholt' || raw === 'Picked Up' || raw === '__pickup__') return t.pickedUp; if (raw === 'Owner' || raw === '__owner__') return t.pickedUp; return raw; })();
                      const status = typeof claim === 'string' ? 'delivering' : claim.status;
                      const color = status === 'delivered' ? '#2fc053' : status === 'delivering' ? '#16a085' : '#2980b9';
                      return (
                        <>
                          <Ionicons name={status === 'delivered' ? 'checkmark-circle-outline' : status === 'delivering' ? 'car-outline' : 'bag-outline'} size={14} color={color} />
                          <Text style={[styles.courierName, { color: '#111' }]}>{name}</Text>
                        </>
                      );
                    })()}
                  </View>
                ) : null}
              </View>

              {/* EXPANDED DETAILS - exactly like expanded card */}
              <View style={[styles.divider, { marginTop: 8 }]} />

              {/* Created at */}
              {selectedOrder.date_created ? (
                <Text style={{ fontSize: Platform.OS === 'android' ? 11 : 13, color: '#999', marginBottom: 8 }}>
                  {t.createdAt || 'Created'}: {new Date(selectedOrder.date_created).toLocaleString()}
                </Text>
              ) : null}

              {/* Auto accepted */}
              {autoPrintOrders[String(selectedOrder.order_id)] && (
                <Text style={{ fontSize: Platform.OS === 'android' ? 11 : 13, color: '#8B38CB', marginBottom: 4 }}>
                  ⚡ Auto accepted: {autoPrintOrders[String(selectedOrder.order_id)].accepted_time}
                </Text>
              )}

              {/* Delivered at */}
              {(() => {
                const claim = claims[String(selectedOrder.order_id)];
                if (claim && claim.status === 'delivered' && claim.delivered_at) {
                  return <Text style={{ fontSize: Platform.OS === 'android' ? 11 : 13, color: '#3498db', marginBottom: 8 }}>✓ {t.deliveredAt} {claim.delivered_at}</Text>;
                }
                return null;
              })()}

              {/* Email */}
              {selectedOrder.customer_email ? (
                <TouchableOpacity style={styles.row} onPress={() => Linking.openURL(`mailto:${selectedOrder.customer_email}`)}>
                  <Ionicons name="mail-outline" size={14} color="#999" />
                  <Text style={[styles.rowValue, styles.linkValue, { fontSize: Platform.OS === 'android' ? 12 : 14 }]}>{selectedOrder.customer_email}</Text>
                </TouchableOpacity>
              ) : null}

              {/* Phone */}
              {selectedOrder.customer_phone ? (
                <TouchableOpacity style={styles.row} onPress={() => Linking.openURL(`tel:${selectedOrder.customer_phone}`)}>
                  <Ionicons name="call-outline" size={14} color="#999" />
                  <Text style={[styles.rowValue, styles.linkValue, { fontSize: Platform.OS === 'android' ? 12 : 14 }]}>{selectedOrder.customer_phone}</Text>
                </TouchableOpacity>
              ) : null}

              {/* Address */}
              {selectedOrder.shipping_address ? (
                <TouchableOpacity style={[styles.row, !selectedOrder.note && { borderBottomWidth: 0 }]} onPress={() => { const encoded = encodeURIComponent(selectedOrder.shipping_address); Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${encoded}`); }}>
                  <Ionicons name="location-outline" size={14} color="#999" />
                  <Text style={[styles.rowValue, styles.linkValue, { fontSize: Platform.OS === 'android' ? 12 : 14 }]}>{selectedOrder.shipping_address}</Text>
                </TouchableOpacity>
              ) : null}

              {/* Note */}
              {selectedOrder.note ? (
                <View style={[styles.row, { borderBottomWidth: 0, marginTop: 4 }]}>
                  <View style={{ backgroundColor: '#fffbeb', borderRadius: 8, padding: 10, flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderLeftWidth: 3, borderLeftColor: '#f39c12' }}>
                    <Ionicons name="alert-circle-outline" size={14} color="#f39c12" style={{ marginTop: 1 }} />
                    <Text style={{ fontSize: Platform.OS === 'android' ? 12 : 14, color: '#111', fontWeight: '600', flex: 1 }}>{selectedOrder.note}</Text>
                  </View>
                </View>
              ) : null}

              {/* Items */}
              {selectedOrder.items && selectedOrder.items.length > 0 && (
                <>
                  <View style={[styles.divider, { marginTop: 8 }]} />
                  {selectedOrder.items.map((item, i) => (
                    <View key={i} style={{ marginBottom: 8 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ fontSize: Platform.OS === 'android' ? 12 : 14, fontWeight: '600', color: '#111', flex: 1 }}>{item.quantity}x {item.name}</Text>
                        <Text style={{ fontSize: Platform.OS === 'android' ? 12 : 14, fontWeight: '600', color: '#111' }}>{selectedOrder.currency} {item.total}</Text>
                      </View>
                      {item.addons && item.addons.length > 0 && item.addons.map((addon, j) => (
                        <Text key={j} style={{ fontSize: Platform.OS === 'android' ? 11 : 12, color: '#666', paddingLeft: 8 }}>↳ {addon.label}: {addon.value}</Text>
                      ))}
                    </View>
                  ))}
                </>
              )}

              {/* Mark delivered / pickup button */}
              {(() => {
                const isPickupMethod = (method?: string) => {
                  const m = (method || '').toLowerCase().trim();
                  return m.includes('abholung') || m.includes('abholen') || m.includes('selbstabholung') || m.includes('pickup') || m.includes('pick up') || m.includes('local_pickup') || m.includes('local pickup') || m.includes('orderable_pickup') || m.includes('takeaway') || m.includes('take away');
                };
                const claim = claims[String(selectedOrder.order_id)];
                const status = claim ? (typeof claim === 'string' ? 'delivering' : claim.status) : 'new';
                const acceptedData = acceptedTimes[String(selectedOrder.order_id)];
                const isOverdue = acceptedData ? (() => {
                  const at = acceptedData.accepted_time || '';
                  const isScheduledTime = at.includes('—') || (at.includes(':') && !at.includes('Minutes'));
                  if (isScheduledTime) {
                    const parts = at.split('—');
                    if (parts.length < 2) return false;
                    const timePart = parts[0].trim();
                    const datePart = parts[1].trim().split('/');
                    if (datePart.length < 3) return false;
                    const scheduledMs = new Date(`${datePart[2]}-${datePart[1]}-${datePart[0]}T${timePart}:00`).getTime();
                    return Date.now() > scheduledMs;
                  }
                  const minutes = parseInt(at.replace(/[^0-9]/g, '') || '0');
                  const acceptedAt = new Date(acceptedData.accepted_at).getTime();
                  const deadline = acceptedAt + minutes * 60 * 1000;
                  return Date.now() > deadline;
                })() : false;
                const isPickup = isPickupMethod(selectedOrder.shipping_method);
                if (status !== 'delivered' && selectedOrder.status !== 'cancelled' && (isOverdue || isPickup)) {
                  return (
                    <TouchableOpacity
                      style={{ backgroundColor: isPickup ? '#2ecc71' : '#3498db', borderRadius: 12, padding: 14, alignItems: 'center', marginTop: 12, flexDirection: 'row', justifyContent: 'center', gap: 8 }}
                      onPress={async () => {
                        const isPickupReady = pickupReadyOrders[String(selectedOrder.order_id)];
                        if (isPickup && !isPickupReady) {
                          setAlertConfig({
                            visible: true,
                            title: t.readyForPickup || 'Ready for Pickup',
                            message: t.readyForPickupMsg || 'Send an email to the customer that their order is ready?',
                            icon: 'bag-check-outline',
                            iconColor: '#2ecc71',
                            buttons: [
                              { text: t.sendEmail || 'Send Email', color: '#2ecc71', onPress: async () => {
                                const code = await AsyncStorage.getItem('restaurant_code') || '';
                                const restaurantProfile = await fetch(`${BACKEND_URL}/restaurant-profile/${code}`).then(r => r.json()).catch(() => ({}));
                                const website = restaurantProfile?.profile?.website;
                                if (website) { const baseUrl = website.startsWith('http') ? website : `https://${website}`; fetch(`${baseUrl}/wp-json/foodup/v1/order-ready-pickup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: 'foodup2026', order_id: selectedOrder.order_id }) }).catch(() => {}); }
                                const updated = { ...pickupReadyOrders, [String(selectedOrder.order_id)]: true };
                                setPickupReadyOrders(updated);
                                await AsyncStorage.setItem('pickup_ready_orders', JSON.stringify(updated));
                              }},
                              { text: t.skipEmail || 'Skip Email', color: '#e74c3c', onPress: async () => { const updated = { ...pickupReadyOrders, [String(selectedOrder.order_id)]: true }; setPickupReadyOrders(updated); await AsyncStorage.setItem('pickup_ready_orders', JSON.stringify(updated)); }},
                              { text: t.cancel || 'Cancel', style: 'cancel' },
                            ],
                          });
                          return;
                        }
                        const code = await AsyncStorage.getItem('restaurant_code') || '';
                        const courierName = claim ? (typeof claim === 'string' ? claim : claim.name) : (isPickup ? t.pickedUp : 'Owner');
                        await fetch(`${BACKEND_URL}/mark-delivered`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order_id: selectedOrder.order_id, delivery_name: courierName, restaurant_code: code }) });
                        await fetch(`${BACKEND_URL}/release-claim`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order_id: selectedOrder.order_id, restaurant_code: code }) });
                        const updatedReady = { ...pickupReadyOrders };
                        delete updatedReady[String(selectedOrder.order_id)];
                        setPickupReadyOrders(updatedReady);
                        await AsyncStorage.setItem('pickup_ready_orders', JSON.stringify(updatedReady));
                        const deliveredAt = new Date().toLocaleString();
                        setClaims(prev => ({ ...prev, [String(selectedOrder.order_id)]: { name: courierName, status: 'delivered', delivered_at: deliveredAt } }));
                        setSelectedOrder(null);
                      }}
                    >
                      <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                      <Text style={{ color: '#fff', fontSize: Platform.OS === 'android' ? 13 : 15, fontWeight: '600' }}>
                        {isPickup ? (pickupReadyOrders[String(selectedOrder.order_id)] ? t.markPickedUp : t.readyForPickup || 'Ready for Pickup') : t.markDelivered}
                      </Text>
                    </TouchableOpacity>
                  );
                }
                return null;
              })()}
            </View>
          </ScrollView>
        </SafeAreaView>
        <CustomAlert
          visible={alertConfig.visible}
          title={alertConfig.title}
          message={alertConfig.message}
          buttons={alertConfig.buttons}
          icon={alertConfig.icon}
          iconColor={alertConfig.iconColor}
          onClose={() => setAlertConfig(prev => ({ ...prev, visible: false }))}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerPlaceholder} />
        <Image source={require('../../assets/images/logo.png')} style={styles.logo} resizeMode="contain" />
        {storeIsOpen !== null ? (
          <Animated.View style={{
            backgroundColor: storeIsOpen ? '#2ecc71' : '#e74c3c',
            borderRadius: 12,
            paddingHorizontal: 8,
            paddingVertical: 4,
            opacity: pulseAnim,
          }}>
            <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>
              {storeIsOpen ? t.openStore.toUpperCase() : t.closeStore.toUpperCase()}
            </Text>
          </Animated.View>
        ) : (
          <View style={styles.headerPlaceholder} />
        )}
      </View>
      <SafeAreaView style={{ flex: 1 }}>
        <FlatList
          ref={listRef}
          data={flatData}
          keyExtractor={(item, index) => item.type === 'order' ? String(item.item.order_id) : `header-${index}`}
          contentContainerStyle={styles.scrollContent}
          stickyHeaderIndices={[2]}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#111" colors={['#111']} />
          }
          ListHeaderComponent={null}
          renderItem={({ item }) => {
            if (item.type === 'storeStatus') {
              return null;
            }
            if (item.type === 'searchBar') {
              return (
                <View style={{ backgroundColor: '#fff', paddingHorizontal: 16, paddingVertical: Platform.OS === 'ios' ? 8 : 1, borderBottomWidth: 1, borderBottomColor: '#F0F0F0', flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                  <Ionicons name="search-outline" size={18} color="#999" />
                  <TextInput style={{ flex: 1, fontSize: 13, color: '#111', height: Platform.OS === 'ios' ? 36 : undefined }} placeholder={t.searchPlaceholder || 'Search by name, phone or order ID'} placeholderTextColor={Platform.OS === 'ios' ? '#ADADAD' : '#C0C0C0'} value={search} onChangeText={setSearch} />
                  {search.length > 0 && (<TouchableOpacity onPress={() => setSearch('')}><Ionicons name="close-circle" size={18} color="#C0C0C0" /></TouchableOpacity>)}
                </View>
              );
            }
            if (item.type === 'filterTabs') {
              return (
                <View style={{ height: 48, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F0F0F0' }}>
                  <FlatList
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    data={[
                      { key: 'all', label: t.all, color: '#111' },
                      { key: 'new', label: t.newOrder, color: '#f39c12' },
                      { key: 'scheduled', label: t.scheduled || 'Scheduled', color: '#8B38CB' },
                      { key: 'in_bag', label: t.inBag, color: '#2980b9' },
                      { key: 'delivering', label: t.delivering, color: '#16a085' },
                      { key: 'delivered', label: t.delivered, color: '#2fc053' },
                      { key: 'pickedUp', label: t.pickedUp || 'Picked Up', color: '#8B38CB' },
                      { key: 'cancelled', label: t.cancelled, color: '#e74c3c' },
                    ]}
                    keyExtractor={f => f.key}
                    contentContainerStyle={{ paddingHorizontal: 10, gap: 6, alignItems: 'center', paddingVertical: 10 }}
                    renderItem={({ item: f }) => (
                      <TouchableOpacity
                        onPress={() => setFilter(f.key)}
                        style={{ paddingHorizontal: 10, paddingVertical: 5, borderRadius: 20, backgroundColor: filter === f.key ? f.color : f.key === 'all' ? '#F5F5F5' : f.color + '20', flexDirection: 'row', alignItems: 'center', gap: 6 }}
                      >
                        <Text style={{ fontSize: 11, fontWeight: '600', color: filter === f.key ? '#fff' : f.color === '#111' ? '#666' : f.color }} numberOfLines={1}>{f.label}</Text>
                        <View style={{ backgroundColor: '#fff', borderRadius: 10, minWidth: 18, height: 18, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4 }}>
                          <Text style={{ fontSize: 11, fontWeight: '700', color: filter === f.key ? f.color : f.color }}>{filterCounts[f.key as keyof typeof filterCounts]}</Text>
                        </View>
                      </TouchableOpacity>
                    )}
                  />
                </View>
              );
            }
            if (item.type === 'header') {
              return <Text style={styles.groupLabel}>{item.title}</Text>;
            }
            const order = item.item;
            const isPickupMethod = (method?: string) => {
              const m = (method || '').toLowerCase().trim();
              return m.includes('abholung') || m.includes('abholen') || m.includes('selbstabholung') || m.includes('pickup') || m.includes('pick up') || m.includes('local_pickup') || m.includes('local pickup') || m.includes('orderable_pickup') || m.includes('takeaway') || m.includes('take away');
            };
            return (
              <TouchableOpacity
                style={[styles.section, { paddingTop: 14, paddingBottom: 14 }]}
                onPress={() => setSelectedOrder(order)}
                activeOpacity={0.7}
              >
                <View style={styles.orderTopRow}>
                  <Text style={styles.orderId}>Order #{order.order_id}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    {canPrint && autoPrintOrders[String(order.order_id)] && (
                      <TouchableOpacity
                        onPress={async (e) => {
                          e.stopPropagation();
                          const printData = autoPrintOrders[String(order.order_id)];
                          const orderObj = { ...order, items: typeof printData.items === 'string' ? JSON.parse(printData.items) : printData.items };
                          const acceptedTime = printData.accepted_time || '';
                          const mins = parseInt(acceptedTime);
                          const isScheduledTime = acceptedTime.includes('—') || acceptedTime.includes(':');
                          const success = await (isScheduledTime ? printOrder(orderObj, undefined, false, '', acceptedTime) : printOrder(orderObj, isNaN(mins) ? 30 : mins)).catch(() => false);
                          if (success) {
                            await AsyncStorage.removeItem(`auto_print_${order.order_id}`);
                            setAutoPrintOrders(prev => { const updated = { ...prev }; delete updated[String(order.order_id)]; return updated; });
                          }
                        }}
                        style={{ backgroundColor: '#8B38CB', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 4 }}
                      >
                        <Ionicons name="print-outline" size={14} color="#fff" />
                        <Text style={{ color: '#fff', fontSize: 11, fontWeight: '700' }}>Auto</Text>
                      </TouchableOpacity>
                    )}
                    <View style={[styles.statusPill, { backgroundColor: getDeliveryStatusColor(claims[String(order.order_id)]) + '20' }]}>
                      <Text style={[styles.statusPillText, { color: getDeliveryStatusColor(claims[String(order.order_id)]) }]}>
                        {getDeliveryStatusLabel(claims[String(order.order_id)], order, t)}
                      </Text>
                    </View>
                  </View>
                </View>
                <View style={styles.divider} />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Ionicons name="person-outline" size={16} color="#999" />
                    <Text style={styles.orderCustomer}>{order.customer_name}</Text>
                  </View>
                  {order.orderable_order_time ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Ionicons name={isScheduledOrder(order) ? 'calendar-outline' : 'flash-outline'} size={13} color={isScheduledOrder(order) ? '#8B38CB' : '#f39c12'} />
                      <Text style={{ fontSize: 13, fontWeight: '700', color: isScheduledOrder(order) ? '#8B38CB' : '#f39c12' }}>
                        {isScheduledOrder(order) ? t.scheduled : t.asapShort}
                      </Text>
                    </View>
                  ) : null}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                  <View style={styles.orderMeta}>
                    <Ionicons name="cash-outline" size={14} color="#999" />
                    <Text style={styles.orderTotal}>{order.currency} {order.total}</Text>
                  </View>
                  {(() => {
                    const isCash = order.payment_method?.toLowerCase().includes('bar') || order.payment_method?.toLowerCase().includes('cash');
                    return (
                      <View style={styles.orderMeta}>
                        <Ionicons name={isCash ? 'cash-outline' : 'card-outline'} size={14} color={isCash ? '#e74c3c' : '#2ecc71'} />
                        <Text style={[styles.orderTotal, { color: isCash ? '#e74c3c' : '#2ecc71' }]}>{isCash ? t.notPaid : t.paidOnline}</Text>
                      </View>
                    );
                  })()}
                </View>
                {acceptedTimes[String(order.order_id)] && (() => {
                  const claim = claims[String(order.order_id)];
                  const status = claim ? (typeof claim === 'string' ? 'delivering' : claim.status) : 'new';
                  const at = acceptedTimes[String(order.order_id)].accepted_time || '';
                  const isItemScheduled = at.includes('—') || (at.includes(':') && !at.includes('Minutes'));
                  if (status === 'delivered') return null;
                  if (isItemScheduled) {
                    const scheduledStr = at.split('—')[0].trim();
                    const scheduledDateStr = at.split('—')[1]?.trim();
                    const parts = scheduledDateStr?.split('/');
                    const scheduledMs = parts ? new Date(`${parts[2]}-${parts[1]}-${parts[0]}T${scheduledStr}:00`).getTime() : null;
                    if (!scheduledMs) return null;
                    return <ScheduledCountdown scheduledMs={scheduledMs} at={at} />;
                  }
                  return <OrderCountdown accepted_at={acceptedTimes[String(order.order_id)].accepted_at} accepted_time={at} />;
                })()}
                {!(acceptedTimes[String(order.order_id)] && (() => {
                  const claim = claims[String(order.order_id)];
                  const status = claim ? (typeof claim === 'string' ? 'delivering' : claim.status) : 'new';
                  return status !== 'delivered';
                })()) && <View style={[styles.divider, { marginBottom: 0 }]} />}
                <View style={styles.orderBottomRow}>
                  {order.shipping_method ? (
                    <View style={styles.orderMeta}>
                      <Ionicons name={order.shipping_method === 'Abholung' ? 'bag-outline' : 'bicycle-outline'} size={14} color="#999" />
                      <Text style={styles.orderShipping}>{order.shipping_method === 'Abholung' ? t.pickupLabel : order.shipping_method === 'Lieferung' ? t.deliveryLabel : order.shipping_method}</Text>
                    </View>
                  ) : <View />}
                  {claims[String(order.order_id)] ? (
                    <View style={styles.orderMeta}>
                      {(() => {
                        const claim = claims[String(order.order_id)];
                        const name = (() => { const raw = typeof claim === 'string' ? claim : claim.name; if (raw === 'Abgeholt' || raw === 'Picked Up' || raw === '__pickup__') return t.pickedUp; if (raw === 'Owner' || raw === '__owner__') return t.pickedUp; return raw; })();
                        const status = typeof claim === 'string' ? 'delivering' : claim.status;
                        const color = status === 'delivered' ? '#2fc053' : status === 'delivering' ? '#16a085' : '#2980b9';
                        return (
                          <>
                            <Ionicons name={status === 'delivered' ? 'checkmark-circle-outline' : status === 'delivering' ? 'car-outline' : 'bag-outline'} size={14} color={color} />
                            <Text style={[styles.courierName, { color: '#111' }]}>{name}</Text>
                          </>
                        );
                      })()}
                    </View>
                  ) : null}
                </View>
              </TouchableOpacity>
            );
          }}
        />
        </SafeAreaView>
      <CustomAlert
        visible={alertConfig.visible}
        title={alertConfig.title}
        message={alertConfig.message}
        buttons={alertConfig.buttons}
        icon={alertConfig.icon}
        iconColor={alertConfig.iconColor}
        onClose={() => setAlertConfig(prev => ({ ...prev, visible: false }))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F7F7' },
  header: {
  backgroundColor: '#fff',
  paddingTop: Platform.OS === 'android' ? 40 : 65,
  paddingBottom: 12,
  borderBottomWidth: 1,
  borderBottomColor: '#F0F0F0',
  flexDirection: 'row',
  alignItems: 'center',
  justifyContent: 'space-between',
  paddingHorizontal: 16,
},
  logo: { width: 100, height: 30 },
  headerPlaceholder: { width: 36 },
  backCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center' },
  backArrow: { fontSize: 24, color: '#111', lineHeight: 24, textAlignVertical: 'center', includeFontPadding: false },
  scrollContent: { paddingBottom: 40, paddingTop: 0 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10 },
  emptyText: { fontSize: 16, fontWeight: '600', color: '#333', marginTop: 8 },
  emptySubText: { fontSize: 14, color: '#999' },
  groupLabel: { fontSize: 13, fontWeight: '500', color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 24, marginBottom: 8, marginHorizontal: 20 },
  section: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 10, borderRadius: 14, paddingLeft: 16, paddingRight: 16, paddingTop: 5, paddingBottom: 5, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  orderTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  orderId: { fontSize: Platform.OS === 'android' ? 13 : 13, color: '#666', fontWeight: '500' },
  statusPill: { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  statusPillText: { fontSize: Platform.OS === 'android' ? 11 : 12, fontWeight: '600' },
  divider: { height: 1, backgroundColor: '#F0F0F0', marginVertical: 10 },
  orderCustomer: { fontSize: Platform.OS === 'android' ? 15 : 16, fontWeight: '700', color: '#111', marginBottom: 2 },
  orderFooter: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  orderTotal: { fontSize: Platform.OS === 'android' ? 12 : 14, fontWeight: '600', color: '#111' },
  orderShipping: { fontSize: Platform.OS === 'android' ? 12 : 14, color: '#111', fontWeight: '600' },
  orderDate: { fontSize: 13, color: '#999', alignSelf: 'center' },
  orderMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  detailTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 16, marginTop: 16, marginBottom: 4 },
  detailOrderId: { fontSize: 24, fontWeight: '700', color: '#111', letterSpacing: -0.5 },
  detailDate: { fontSize: 13, color: '#999', marginHorizontal: 16, marginBottom: 8 },
  statusBadge: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  statusBadgeText: { fontSize: 13, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  rowValue: { fontSize: 14, color: '#111', fontWeight: '500', flex: 1 },
  linkValue: { color: '#007AFF' },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  itemName: { fontSize: 15, fontWeight: '600', color: '#111', flex: 1, marginRight: 8 },
  itemTotal: { fontSize: 14, fontWeight: '600', color: '#111' },
  addonsContainer: { marginTop: 8, paddingTop: 8, borderTopWidth: 1, borderTopColor: '#F0F0F0' },
  addonText: { fontSize: 13, color: '#666', marginBottom: 2 },
  totalRow: { flexDirection: 'row', justifyContent: 'space-between', marginHorizontal: 16, marginTop: 4, marginBottom: 24, padding: 16, backgroundColor: '#fff', borderRadius: 14, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  totalLabel: { fontSize: 16, fontWeight: '700', color: '#111' },
  totalValue: { fontSize: 16, fontWeight: '700', color: '#111' },
  orderNameRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  orderBottomRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  courierName: { fontSize: Platform.OS === 'android' ? 12 : 14, color: '#8B38CB', fontWeight: '500' },
  
  
});