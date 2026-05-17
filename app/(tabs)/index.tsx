import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  FlatList,
  Image,
  InteractionManager,
  Linking,
  Modal,
  Platform,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from 'react-native';
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

function OrderCountdown({ accepted_at, accepted_time }: { accepted_at: string; accepted_time: string }) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [totalSeconds, setTotalSeconds] = useState<number>(0);

  useEffect(() => {
    if (!accepted_at || !accepted_time) return;
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
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 }}>
        <Ionicons name="time-outline" size={13} color={color} />
        <Text style={{ fontSize: 12, fontWeight: '700', color }}>
          {isLate ? `${mins}m ${secs}s overdue` : `${mins}m ${secs}s remaining`}
        </Text>
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
    case 'delivered': return '#3498db';
    case 'delivering': return '#f39c12';
    case 'in_bag': return '#9b59b6';
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

function AcceptRejectModal({ order, visible, onClose }: { order: Order | null, visible: boolean, onClose: () => void }) {
  const [step, setStep] = useState<'main' | 'accept' | 'reject'>('main');
  const [selectedTime, setSelectedTime] = useState<number | null>(null);
  const [selectedReason, setSelectedReason] = useState<string>('');
  const [customReason, setCustomReason] = useState<string>('');
  const [loading, setLoading] = useState(false);

  const times = [15, 20, 25, 30, 45, 60];
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
            accepted_time: `${selectedTime} Minutes`,
          }),
        }).catch(e => console.log('wp accept error:', e));
      }

      setLoading(false);
      onClose();
      InteractionManager.runAfterInteractions(() => {
        setTimeout(() => {
          printOrder(order, selectedTime).catch(e => console.log('print accept error:', e));
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
              <Text style={{ fontSize: 20, fontWeight: '700', color: '#111', marginBottom: 2 }}>
                Order #{order.order_id}
              </Text>
              <Text style={{ fontSize: 14, color: '#999', marginBottom: 4 }}>
                {order.customer_name} · {order.currency} {order.total}
              </Text>
              {(order as any).orderable_order_date || (order as any).orderable_order_time ? (
                <Text style={{ fontSize: 13, color: '#2ecc71', marginBottom: 4 }}>
                  🕐 {(order as any).orderable_order_time?.toLowerCase().includes('as soon as possible') ? 'ASAP' : (order as any).orderable_order_time?.replace(/\s*\(.*?\)\s*/g, '').trim()} — {(order as any).orderable_order_date}
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
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>Accept Order</Text>
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
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>Reject Order</Text>
              </TouchableOpacity>
              </>
          )}

          {step === 'accept' && (
            <>
              <TouchableOpacity onPress={() => setStep('main')} style={{ marginBottom: 16 }}>
                <Text style={{ color: '#007AFF', fontSize: 14 }}>← Back</Text>
              </TouchableOpacity>
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#111', marginBottom: 16 }}>
                Select Preparation Time
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
                    <Text style={{ fontSize: 16, fontWeight: '600', color: '#111' }}>{time} minutes</Text>
                    {selectedTime === time && (
                      <Ionicons name="checkmark-circle" size={20} color="#2ecc71" />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
              <TouchableOpacity
                style={{
                  backgroundColor: selectedTime ? '#111' : '#ccc',
                  borderRadius: 14,
                  padding: 16,
                  alignItems: 'center',
                  flexDirection: 'row',
                  justifyContent: 'center',
                  gap: 8,
                }}
                onPress={handleConfirmAccept}
                disabled={!selectedTime || loading}
              >
                <Ionicons name="print-outline" size={20} color="#fff" />
                <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>
                  {loading ? 'Printing...' : 'Confirm & Print'}
                </Text>
              </TouchableOpacity>
            </>
          )}

          {step === 'reject' && (
            <>
              <TouchableOpacity onPress={() => setStep('main')} style={{ marginBottom: 16 }}>
                <Text style={{ color: '#007AFF', fontSize: 14 }}>← Back</Text>
              </TouchableOpacity>
              <Text style={{ fontSize: 18, fontWeight: '700', color: '#111', marginBottom: 16 }}>
                Select Rejection Reason
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
                  placeholder="Enter reason..."
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
                  {loading ? 'Printing...' : 'Confirm & Print'}
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
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [claims, setClaims] = useState<{ [key: string]: any }>({});
const [acceptedTimes, setAcceptedTimes] = useState<{ [key: string]: any }>({});
const [filter, setFilter] = useState<string>('all');
const [search, setSearch] = useState<string>('');
const [acceptRejectOrder, setAcceptRejectOrder] = useState<Order | null>(null);
const [showAcceptReject, setShowAcceptReject] = useState(false);
  const { t } = useLanguage();
  const router = useRouter();
  const listRef = useRef<any>(null);

  useFocusEffect(
    useCallback(() => {
      fetchOrdersFromBackend();
      fetchClaims();
      listRef.current?.scrollToLocation({ sectionIndex: 0, itemIndex: 0, animated: true, viewOffset: 0 });
    }, [])
  );

  useEffect(() => {
    AsyncStorage.getItem('user_role').then(r => {
      setRole(r);
      if (r === 'delivery') router.replace('/(tabs)/delivery');
    });
    fetchOrdersFromBackend();
    fetchClaims();

    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        fetchOrdersFromBackend();
        fetchClaims();
      }
    });

    const claimsInterval = setInterval(() => fetchClaims(), 10000);
    const ordersInterval = setInterval(() => fetchOrdersFromBackend(), 30000);
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
              setAcceptRejectOrder(newOrder);
              setShowAcceptReject(true);
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
      clearInterval(newOrderInterval);
    };
  }, []);

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
          setAcceptRejectOrder(newOrder);
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

  const getDeliveryStatus = (order: Order) => {
    const claim = claims[String(order.order_id)];
    if (order.status === 'cancelled') return 'cancelled';
    if (!claim) return 'new';
    const status = typeof claim === 'string' ? 'delivering' : claim.status;
    return status;
  };

  const filteredOrders = orders
    .filter(o => filter === 'all' || getDeliveryStatus(o) === filter)
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

  const filterCounts = {
    new: orders.filter(o => getDeliveryStatus(o) === 'new').length,
    in_bag: orders.filter(o => getDeliveryStatus(o) === 'in_bag').length,
    delivering: orders.filter(o => getDeliveryStatus(o) === 'delivering').length,
    delivered: orders.filter(o => getDeliveryStatus(o) === 'delivered').length,
    cancelled: orders.filter(o => getDeliveryStatus(o) === 'cancelled').length,
    all: orders.length,
  };

  if (role === 'delivery') return null;

  if (selectedOrder) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setSelectedOrder(null)} style={styles.backCircle}>
            <Text style={styles.backArrow}>‹</Text>
          </TouchableOpacity>
          <Image source={require('../../assets/images/logo.png')} style={styles.logo} resizeMode="contain" />
          {Platform.OS !== 'ios' ? (
            <TouchableOpacity onPress={() => printOrder(selectedOrder)} style={styles.backCircle}>
              <Ionicons name="print-outline" size={20} color="#111" />
            </TouchableOpacity>
          ) : (
            <View style={styles.backCircle} />
          )}
        </View>

        <SafeAreaView style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.scrollContent}>
            <View style={styles.detailTitleRow}>
              <Text style={styles.detailOrderId}>Order #{selectedOrder.order_id}</Text>
              <View style={[styles.statusBadge, { backgroundColor: getDeliveryStatusColor(claims[String(selectedOrder.order_id)]) + '20' }]}>
                <Text style={[styles.statusBadgeText, { color: getDeliveryStatusColor(claims[String(selectedOrder.order_id)]) }]}>
                  {getDeliveryStatusLabel(claims[String(selectedOrder.order_id)], selectedOrder, t)}
                </Text>
              </View>
            </View>
            <Text style={styles.detailDate}>{selectedOrder.date}</Text>
            {(() => {
              const claim = claims[String(selectedOrder.order_id)];
              if (claim && claim.status === 'delivered' && claim.delivered_at) {
                return <Text style={{ fontSize: 13, color: '#3498db', marginHorizontal: 16, marginBottom: 8 }}>✓ {t.deliveredAt} {claim.delivered_at}</Text>;
              }
              return null;
            })()}
            {(selectedOrder as any).orderable_order_date || (selectedOrder as any).orderable_order_time ? (
              <Text style={{ fontSize: 14, color: '#2ecc71', marginHorizontal: 16, marginBottom: 8, fontWeight: '600' }}>
                🕐 {(selectedOrder as any).orderable_order_time?.toLowerCase().includes('as soon as possible') ? 'ASAP' : (selectedOrder as any).orderable_order_time?.replace(/\s*\(.*?\)\s*/g, '').trim()} — {(selectedOrder as any).orderable_order_date}
              </Text>
            ) : null}

            <Text style={styles.groupLabel}>{t.customer}</Text>
            <View style={styles.section}>
              <View style={styles.row}>
                <Ionicons name="person-outline" size={16} color="#999" />
                <Text style={styles.rowValue}>{selectedOrder.customer_name}</Text>
              </View>
              {selectedOrder.customer_email ? (
                <TouchableOpacity
                  style={[styles.row, !selectedOrder.customer_phone && { borderBottomWidth: 0 }]}
                  onPress={() => Linking.openURL(`mailto:${selectedOrder.customer_email}`)}
                >
                  <Ionicons name="mail-outline" size={16} color="#999" />
                  <Text style={[styles.rowValue, styles.linkValue]}>{selectedOrder.customer_email}</Text>
                </TouchableOpacity>
              ) : null}
              {selectedOrder.customer_phone ? (
                <TouchableOpacity
                  style={[styles.row, { borderBottomWidth: 0 }]}
                  onPress={() => Linking.openURL(`tel:${selectedOrder.customer_phone}`)}
                >
                  <Ionicons name="call-outline" size={16} color="#999" />
                  <Text style={[styles.rowValue, styles.linkValue]}>{selectedOrder.customer_phone}</Text>
                </TouchableOpacity>
              ) : null}
            </View>

            <Text style={styles.groupLabel}>{t.orderDetails}</Text>
            <View style={styles.section}>
              <View style={styles.row}>
                <Ionicons name="cash-outline" size={16} color="#999" />
                <Text style={styles.rowValue}>{selectedOrder.currency} {selectedOrder.total}</Text>
              </View>
              {selectedOrder.payment_method ? (
                <View style={[styles.row, !selectedOrder.shipping_method && !selectedOrder.shipping_address && !selectedOrder.note && { borderBottomWidth: 0 }]}>
                  <Ionicons name="card-outline" size={16} color="#999" />
                  <Text style={styles.rowValue}>
                    {selectedOrder.payment_method?.toLowerCase().includes('bar') || selectedOrder.payment_method?.toLowerCase().includes('cash') ? t.cash : t.online}
                  </Text>
                </View>
              ) : null}
              {selectedOrder.shipping_method ? (
                <View style={[styles.row, !selectedOrder.shipping_address && !selectedOrder.note && { borderBottomWidth: 0 }]}>
                  <Ionicons name="bicycle-outline" size={16} color="#999" />
                  <Text style={styles.rowValue}>
                    {selectedOrder.shipping_method === 'Abholung' ? t.pickupLabel : selectedOrder.shipping_method === 'Lieferung' ? t.deliveryLabel : selectedOrder.shipping_method}
                  </Text>
                </View>
              ) : null}
              {selectedOrder.shipping_address ? (
                <TouchableOpacity
                  style={[styles.row, !selectedOrder.note && { borderBottomWidth: 0 }]}
                  onPress={() => {
                    const encoded = encodeURIComponent(selectedOrder.shipping_address);
                    Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${encoded}`);
                  }}
                >
                  <Ionicons name="location-outline" size={16} color="#999" />
                  <Text style={[styles.rowValue, styles.linkValue]}>{selectedOrder.shipping_address}</Text>
                </TouchableOpacity>
              ) : null}
              {selectedOrder.note ? (
                <View style={[styles.row, { borderBottomWidth: 0 }]}>
                  <View style={{ 
                    backgroundColor: '#fffbeb', 
                    borderRadius: 8, 
                    padding: 10, 
                    flex: 1,
                    flexDirection: 'row',
                    alignItems: 'flex-start',
                    gap: 8,
                    borderLeftWidth: 3,
                    borderLeftColor: '#f39c12',
                  }}>
                    <Ionicons name="alert-circle-outline" size={16} color="#f39c12" style={{ marginTop: 1 }} />
                    <Text style={{ fontSize: 14, color: '#111', fontWeight: '600', flex: 1 }}>{selectedOrder.note}</Text>
                  </View>
                </View>
              ) : null}
            </View>

            <Text style={styles.groupLabel}>{t.items}</Text>
            {selectedOrder.items.map((item, i) => (
              <View key={i} style={[styles.section, { marginBottom: 8, paddingTop: 14, paddingBottom: 14 }]}>
                <View style={styles.itemHeader}>
                  <Text style={styles.itemName}>{item.quantity}x {item.name}</Text>
                  <Text style={styles.itemTotal}>{selectedOrder.currency} {item.total}</Text>
                </View>
                {item.addons && item.addons.length > 0 && (
                  <View style={styles.addonsContainer}>
                    {item.addons.map((addon, j) => (
                      <Text key={j} style={styles.addonText}>↳ {addon.label}: {addon.value}</Text>
                    ))}
                  </View>
                )}
              </View>
            ))}

            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>{t.total}</Text>
              <Text style={styles.totalValue}>{selectedOrder.currency} {selectedOrder.total}</Text>
            </View>

            

            {(() => {
              const claim = claims[String(selectedOrder.order_id)];
              const status = claim ? (typeof claim === 'string' ? 'delivering' : claim.status) : 'new';
              const acceptedData = acceptedTimes[String(selectedOrder.order_id)];
              const isOverdue = acceptedData ? (() => {
                const minutes = parseInt(acceptedData.accepted_time?.replace(/[^0-9]/g, '') || '0');
                const acceptedAt = new Date(acceptedData.accepted_at).getTime();
                const deadline = acceptedAt + minutes * 60 * 1000;
                return Date.now() > deadline;
              })() : false;
              const isPickup = selectedOrder.shipping_method === 'Abholung' || selectedOrder.shipping_method?.toLowerCase().includes('pickup');
              if (status !== 'delivered' && selectedOrder.status !== 'cancelled' && (isOverdue || isPickup)) {
                return (
                  <TouchableOpacity
                    style={{
                      backgroundColor: selectedOrder.shipping_method === 'Abholung' || selectedOrder.shipping_method?.toLowerCase().includes('pickup') ? '#2ecc71' : '#3498db',
                      borderRadius: 12,
                      padding: 16,
                      alignItems: 'center',
                      marginHorizontal: 16,
                      marginBottom: 16,
                      flexDirection: 'row',
                      justifyContent: 'center',
                      gap: 8,
                    }}
                    onPress={async () => {
                      const code = await AsyncStorage.getItem('restaurant_code') || '';
                      const claim = claims[String(selectedOrder.order_id)];
                      const courierName = claim ? (typeof claim === 'string' ? claim : claim.name) : 'Owner';
                      await fetch(`${BACKEND_URL}/mark-delivered`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          order_id: selectedOrder.order_id,
                          delivery_name: courierName,
                          restaurant_code: code,
                        }),
                      });
                      await fetch(`${BACKEND_URL}/release-claim`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          order_id: selectedOrder.order_id,
                          restaurant_code: code,
                        }),
                      });
                      const deliveredAt = new Date().toLocaleString();
                      setClaims(prev => ({
                        ...prev,
                        [String(selectedOrder.order_id)]: { name: courierName, status: 'delivered', delivered_at: deliveredAt },
                      }));
                      setSelectedOrder(null);
                    }}
                  >
                    <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
                    <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>
                      {selectedOrder.shipping_method === 'Abholung' || selectedOrder.shipping_method?.toLowerCase().includes('pickup') ? t.markPickedUp : t.markDelivered}
                    </Text>
                  </TouchableOpacity>
                );
              }
              return null;
            })()}
          </ScrollView>
        </SafeAreaView>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerPlaceholder} />
        <Image source={require('../../assets/images/logo.png')} style={styles.logo} resizeMode="contain" />
        <View style={styles.headerPlaceholder} />
      </View>
      <SafeAreaView style={{ flex: 1 }}>
        <View style={{ 
            backgroundColor: '#fff', 
            paddingHorizontal: 16, 
            paddingVertical: 3,
            borderBottomWidth: 1,
            borderBottomColor: '#F0F0F0',
            flexDirection: 'row',
            alignItems: 'center',
            gap: 10,
          }}>
            <Ionicons name="search-outline" size={18} color="#999" />
            <TextInput
              style={{ flex: 1, fontSize: 15, color: '#111' }}
              placeholder="Search by name, phone or order ID"
              placeholderTextColor="#C0C0C0"
              value={search}
              onChangeText={setSearch}
              clearButtonMode="while-editing"
            />
          </View>
          <View style={{ height: 40, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#F0F0F0' }}>
          <FlatList
            horizontal
            showsHorizontalScrollIndicator={false}
            data={[
              { key: 'all', label: t.all, color: '#111' },
              { key: 'new', label: t.newOrder, color: '#f39c12' },
              { key: 'in_bag', label: t.inBag, color: '#9b59b6' },
              { key: 'delivering', label: t.delivering, color: '#dfdb02' },
              { key: 'delivered', label: t.delivered, color: '#2fc053' },
              { key: 'cancelled', label: t.cancelled, color: '#e74c3c' },
            ]}
            keyExtractor={item => item.key}
            contentContainerStyle={{ paddingHorizontal: 10, gap: 6, alignItems: 'center', paddingVertical: 10 }}
            renderItem={({ item: f }) => (
              <TouchableOpacity
                onPress={() => setFilter(f.key)}
                style={{
                  paddingHorizontal: 10,
                  paddingVertical: 5,
                  borderRadius: 20,
                  backgroundColor: filter === f.key ? f.color : f.key === 'all' ? '#F5F5F5' : f.color + '20',
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <Text style={{
                  fontSize: 11,
                  fontWeight: '600',
                  color: filter === f.key ? '#fff' : f.color === '#111' ? '#666' : f.color,
                }} numberOfLines={1}>
                  {f.label}
                </Text>
                {filterCounts[f.key as keyof typeof filterCounts] > 0 && (
                  <View style={{
                    backgroundColor: '#fff',
                    borderRadius: 10,
                    minWidth: 18,
                    height: 18,
                    justifyContent: 'center',
                    alignItems: 'center',
                    paddingHorizontal: 4,
                  }}>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: filter === f.key ? f.color : f.color }}>
                      {filterCounts[f.key as keyof typeof filterCounts]}
                    </Text>
                  </View>
                )}
              </TouchableOpacity>
            )}
          />
        </View>
        {orders.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="receipt-outline" size={48} color="#D0D0D0" />
            <Text style={styles.emptyText}>{t.noOrders}</Text>
            <Text style={styles.emptySubText}>{t.noOrdersSub}</Text>
          </View>
        ) : filteredOrders.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="filter-outline" size={48} color="#D0D0D0" />
            <Text style={styles.emptyText}>{t.noOrdersFilter}</Text>
          </View>
        ) : (
          <SectionList
            ref={listRef}
            sections={sections}
            keyExtractor={(item) => String(item.order_id)}
            contentContainerStyle={styles.scrollContent}
            stickySectionHeadersEnabled={false}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#111" colors={['#111']} />
            }
            renderSectionHeader={({ section: { title } }) => (
              <Text style={styles.groupLabel}>{title}</Text>
            )}
            renderItem={({ item }) => (
              <TouchableOpacity style={[styles.section, { paddingTop: 14, paddingBottom: 14 }]} onPress={() => setSelectedOrder(item)}>
                <View style={styles.orderTopRow}>
                  <Text style={styles.orderId}>Order #{item.order_id}</Text>
                  <View style={[styles.statusPill, { backgroundColor: getDeliveryStatusColor(claims[String(item.order_id)]) + '20' }]}>
                    <Text style={[styles.statusPillText, { color: getDeliveryStatusColor(claims[String(item.order_id)]) }]}>
                      {getDeliveryStatusLabel(claims[String(item.order_id)], item, t)}
                    </Text>
                  </View>
                </View>
                <View style={styles.divider} />
                <Text style={styles.orderCustomer}>{item.customer_name}</Text>
                {acceptedTimes[String(item.order_id)] && (
                  <Text style={{ fontSize: 13, color: '#8B38CB', fontWeight: '600', marginTop: 2, marginBottom: 4 }}>
                    ✓ {acceptedTimes[String(item.order_id)].accepted_time}
                  </Text>
                )}
                <View style={styles.orderMeta}>
                  <Ionicons name="cash-outline" size={14} color="#999" />
                  <Text style={styles.orderTotal}>{item.currency} {item.total}</Text>
                </View>
                {acceptedTimes[String(item.order_id)] && 
                  (() => {
                    const claim = claims[String(item.order_id)];
                    const status = claim ? (typeof claim === 'string' ? 'delivering' : claim.status) : 'new';
                    return status !== 'delivered';
                  })() && (
                    <OrderCountdown
                      accepted_at={acceptedTimes[String(item.order_id)].accepted_at}
                      accepted_time={acceptedTimes[String(item.order_id)].accepted_time}
                    />
                  )}
                  <View style={styles.orderBottomRow}>
                  {item.shipping_method ? (
                    <View style={styles.orderMeta}>
                      <Ionicons name={item.shipping_method === 'Abholung' ? 'bag-outline' : 'bicycle-outline'} size={14} color="#999" />
                      <Text style={styles.orderShipping}>
                        {item.shipping_method === 'Abholung' ? t.pickupLabel : item.shipping_method === 'Lieferung' ? t.deliveryLabel : item.shipping_method}
                      </Text>
                    </View>
                  ) : <View />}
                  {claims[String(item.order_id)] ? (
                    <View style={styles.orderMeta}>
                      {(() => {
                        const claim = claims[String(item.order_id)];
                        const name = typeof claim === 'string' ? claim : claim.name;
                        const status = typeof claim === 'string' ? 'delivering' : claim.status;
                        const color = status === 'delivered' ? '#3498db' : status === 'delivering' ? '#f39c12' : '#9b59b6';
                        return (
                          <>
                            <Ionicons 
                              name={
                                status === 'delivered' ? 'checkmark-circle-outline' : 
                                status === 'delivering' ? 'car-outline' : 
                                'bag-outline'
                              } 
                              size={16} 
                              color={color}
                            />
                            <Text style={[styles.courierName, { color: '#111' }]}>{name}</Text>
                          </>
                        );
                      })()}
                    </View>
                  ) : null}
                </View>
              </TouchableOpacity>
            )}
          />
        )}
      </SafeAreaView>
      {Platform.OS !== 'ios' && (
        <AcceptRejectModal
          order={acceptRejectOrder}
          visible={showAcceptReject}
          onClose={() => {
            setShowAcceptReject(false);
            setAcceptRejectOrder(null);
          }}
        />
      )}
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
  backArrow: { fontSize: 24, color: '#111', lineHeight: 28 },
  scrollContent: { paddingBottom: 40, paddingTop: 8 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10 },
  emptyText: { fontSize: 16, fontWeight: '600', color: '#333', marginTop: 8 },
  emptySubText: { fontSize: 14, color: '#999' },
  groupLabel: { fontSize: 13, fontWeight: '500', color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 24, marginBottom: 8, marginHorizontal: 20 },
  section: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 10, borderRadius: 14, paddingLeft: 16, paddingRight: 16, paddingTop: 5, paddingBottom: 5, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  orderTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  orderId: { fontSize: 13, color: '#666', fontWeight: '500' },
  statusPill: { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  statusPillText: { fontSize: 12, fontWeight: '600' },
  divider: { height: 1, backgroundColor: '#F0F0F0', marginVertical: 10 },
  orderCustomer: { fontSize: 17, fontWeight: '700', color: '#111', marginBottom: 8 },
  orderFooter: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  orderTotal: { fontSize: 14, fontWeight: '600', color: '#111' },
  orderShipping: { fontSize: 14, color: '#666' },
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
  courierName: { fontSize: 14, color: '#8B38CB', fontWeight: '500' },
  
  
});