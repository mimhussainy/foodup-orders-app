import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  AppState, Image, Linking, Platform,
  RefreshControl, SafeAreaView, ScrollView,
  StyleSheet, Text, TouchableOpacity, View
} from 'react-native';

import CustomAlert from '../../components/CustomAlert';
import { useLanguage } from '../../lib/useLanguage';
function ScheduledCountdown({ scheduledMs, at }: { scheduledMs: number; at: string }) {
  const [now, setNow] = useState(Date.now());

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
  const { t } = useLanguage();
  const label = isOverdue ? `${mins}m ${secs}s ${t.overdue || 'overdue'}` : hours >= 1 ? `${hours}h ${mins}m ${t.untilScheduled || 'until scheduled time'}` : `${mins}m ${secs}s ${t.untilScheduled || 'until scheduled time'}`;

  return (
    <View style={{ marginTop: 8 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <Text style={{ fontSize: 12, fontWeight: '700', color: barColor }}>🕐 {label}</Text>
        <Text style={{ fontSize: 12, fontWeight: '600', color: '#8B38CB' }}>{t.scheduled || 'Pre-order'} — {at.split('—')[0].trim()}</Text>
      </View>
      {showBar && (
        <View style={{ height: 4, backgroundColor: '#F0F0F0', borderRadius: 2, overflow: 'hidden' }}>
          <View style={{ height: 4, width: `${countdownProgress * 100}%`, backgroundColor: barColor, borderRadius: 2 }} />
        </View>
      )}
    </View>
  );
}
function CountdownTimer({ accepted_at, accepted_time }: { accepted_at: string; accepted_time: string }) {
  const [remaining, setRemaining] = useState<number | null>(null);
  const [totalSeconds, setTotalSeconds] = useState<number>(0);
  const { t } = useLanguage();

  useEffect(() => {
    if (!accepted_at || !accepted_time) return;

    // Skip if scheduled time string
    if (accepted_time.includes('—') || (accepted_time.includes(':') && !accepted_time.includes('Minutes'))) return;

    const minutes = parseInt(accepted_time.replace(/[^0-9]/g, ''));
    if (isNaN(minutes)) return;

    const acceptedDate = new Date(accepted_at);
    if (isNaN(acceptedDate.getTime())) return;

    const deadlineMs = acceptedDate.getTime() + minutes * 60 * 1000;
    const total = minutes * 60;
    setTotalSeconds(total);

    const update = () => {
      const now = Date.now();
      const diff = Math.floor((deadlineMs - now) / 1000);
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
  const progress = Math.max(0, Math.min(1, remaining / totalSeconds));

  const percentage = remaining / totalSeconds;
  const color = isLate ? '#e74c3c' : percentage < 0.25 ? '#e74c3c' : percentage < 0.50 ? '#f39c12' : '#2ecc71';

  return (
    <View style={{ marginTop: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <Ionicons name="time-outline" size={14} color={color} />
        <Text style={{ fontSize: 13, fontWeight: '700', color }}>
          {isLate
            ? `${mins}m ${secs}s ${t.overdue || 'overdue'}`
            : `${mins}m ${secs}s ${t.remaining || 'remaining'}`}
        </Text>
      </View>
      <View style={{ height: 6, backgroundColor: '#F0F0F0', borderRadius: 3, overflow: 'hidden' }}>
        <View style={{
          height: 6,
          width: `${progress * 100}%`,
          backgroundColor: color,
          borderRadius: 3,
        }} />
      </View>
    </View>
  );
}

const BACKEND_URL = 'https://foodup-order-alerts-backend.onrender.com';

interface BagOrder {
  order_id: number;
  customer_name: string;
  customer_phone: string;
  address: string;
  total: string;
  currency: string;
  items: any[];
  payment_method: string;
  status: 'pending' | 'delivering' | 'delivered';
  added_at: string;
  delivered_at?: string;
  accepted_time?: string;
  accepted_at?: string;
  note?: string;
}

function getDateLabel(dateStr: string, t: any) {
  let date = new Date(dateStr);

  if (isNaN(date.getTime())) {
    const parts = dateStr.split(',')[0].split('.');
    if (parts.length === 3) {
      date = new Date(
        `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`
      );
    }
  }

  const today = new Date();

  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);

  const lastWeek = new Date();
  lastWeek.setDate(today.getDate() - 7);

  const lastMonth = new Date();
  lastMonth.setMonth(today.getMonth() - 1);

  if (date.toDateString() === today.toDateString()) return t.today;
  if (date.toDateString() === yesterday.toDateString()) return t.yesterday;
  if (date >= lastWeek) return t.lastWeek;
  if (date >= lastMonth) return t.lastMonth;

  return t.older;
}

function groupByDate(orders: BagOrder[], t: any) {
  const groups: { [key: string]: BagOrder[] } = {};

  orders.forEach(order => {
    const label = getDateLabel(order.delivered_at || order.added_at, t);

    if (!groups[label]) groups[label] = [];
    groups[label].push(order);
  });

  const sortOrder = [
    t.today,
    t.yesterday,
    t.lastWeek,
    t.lastMonth,
    t.older,
  ];

  return sortOrder
    .filter(label => groups[label])
    .map(label => ({ label, orders: groups[label] }));
}

export default function BagScreen() {
  const [bag, setBag] = useState<BagOrder[]>([]);
  const [deliveryName, setDeliveryName] = useState('');
  const [expandedOrders, setExpandedOrders] = useState<number[]>([]);
const [refreshing, setRefreshing] = useState(false);
  const [alertConfig, setAlertConfig] = useState<{ visible: boolean; title: string; message: string; buttons: any[] }>({ visible: false, title: '', message: '', buttons: [] });
  const { t } = useLanguage();

  useFocusEffect(
    useCallback(() => {
      AsyncStorage.getItem('delivery_name').then(n => {
        setDeliveryName(n || '');
        loadBag(n || '');
      });

      // Poll every 10 seconds to sync with backend
      const interval = setInterval(() => {
        loadBag();
      }, 10000);

      // Also sync when app comes to foreground
      const appStateSubscription = AppState.addEventListener('change', (nextState) => {
        if (nextState === 'active') loadBag();
      });

      return () => {
        clearInterval(interval);
        appStateSubscription.remove();
      };
    }, [])
  );

  const loadBag = async (name?: string) => {
    const bagName = name || await AsyncStorage.getItem('delivery_name') || '';
    const code = await AsyncStorage.getItem('restaurant_code') || '';
    const stored = await AsyncStorage.getItem(`delivery_bag_${bagName}`);

    // If bag is empty locally, try to rebuild from backend claims
    if (!stored || JSON.parse(stored).length === 0) {
      try {
        const claimsRes = await fetch(`${BACKEND_URL}/claims/${code}`);
        const claimsResult = await claimsRes.json();
        if (claimsResult.success) {
          const myClaims = Object.entries(claimsResult.claims).filter(
            ([_, claim]: any) => claim.name === bagName && claim.status !== 'delivered'
          );
          if (myClaims.length > 0) {
            const ordersRes = await fetch(`${BACKEND_URL}/orders/${code}`);
            const ordersResult = await ordersRes.json();
            if (ordersResult.success) {
              const rebuiltBag: BagOrder[] = myClaims.map(([orderId, claim]: any) => {
                const order = ordersResult.orders.find((o: any) => String(o.order_id) === String(orderId));
                if (!order) return null;
                return {
                  order_id: parseInt(orderId),
                  customer_name: order.customer_name || '',
                  customer_phone: order.customer_phone || '',
                  address: order.shipping?.address || '',
                  total: String(order.total || ''),
                  currency: order.currency || 'CHF',
                  items: order.items || [],
                  payment_method: order.payment_method || '',
                  status: claim.status === 'delivering' ? 'delivering' : 'pending',
                  added_at: new Date().toLocaleString(),
                  note: order.note || '',
                };
              }).filter(Boolean) as BagOrder[];
              if (rebuiltBag.length > 0) {
                setBag(rebuiltBag);
                await AsyncStorage.setItem(`delivery_bag_${bagName}`, JSON.stringify(rebuiltBag));
                return;
              }
            }
          }
        }
      } catch (e) {}
    }

    if (stored) {
      const parsedBag = JSON.parse(stored);
      setBag(parsedBag);
      
      // Fetch accepted times for orders that don't have them yet
      const code = await AsyncStorage.getItem('restaurant_code') || '';
      const updatedBag = await Promise.all(parsedBag.map(async (order: BagOrder) => {
        if (!order.accepted_time && (order.status === 'pending' || order.status === 'delivering')) {
          try {
            const res = await fetch(`${BACKEND_URL}/accepted-time/${code}/${order.order_id}`);
            const result = await res.json();
            if (result.success && result.accepted_time) {
              return { ...order, accepted_time: result.accepted_time, accepted_at: result.accepted_at };
            }
          } catch (e) {}
        }
        return order;
      }));
      
      setBag(updatedBag);
      await AsyncStorage.setItem(`delivery_bag_${bagName}`, JSON.stringify(updatedBag));
    } else {
      setBag([]);
    }
  };

  const saveBag = async (newBag: BagOrder[]) => {
    setBag(newBag);
    const bagName = await AsyncStorage.getItem('delivery_name') || '';
    await AsyncStorage.setItem(`delivery_bag_${bagName}`, JSON.stringify(newBag));
  };

  const handleStartDelivering = async (order: BagOrder) => {
    const alreadyDelivering = bag.find(o => o.status === 'delivering');
    if (alreadyDelivering) {
      setAlertConfig({
        visible: true,
        title: t.cannotStartDelivery,
        message: t.cannotStartDeliveryMsg,
        buttons: [{ text: 'OK', style: 'cancel' }],
      });
      return;
    }

    const newBag = bag.map(o =>
      o.order_id === order.order_id ? { ...o, status: 'delivering' as const } : o
    );

    await saveBag(newBag);

    const restaurantCode = await AsyncStorage.getItem('restaurant_code') || '';

    await fetch(`${BACKEND_URL}/claim-order`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_id: order.order_id,
        delivery_name: deliveryName,
        restaurant_code: restaurantCode,
        delivery_status: 'delivering',
      }),
    });

    try {
      const profileRes = await fetch(`${BACKEND_URL}/restaurant-profile/${restaurantCode}`);
      const profileData = await profileRes.json();
      const website = profileData?.profile?.website;
      if (website) {
        const baseUrl = website.startsWith('http') ? website : `https://${website}`;
        fetch(`${baseUrl}/wp-json/foodup/v1/order-delivering`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            secret: 'foodup2026',
            order_id: order.order_id,
            delivery_name: deliveryName,
          }),
        }).catch(() => {});
      }
    } catch (e) {}

    if (order.address) {
      const encoded = encodeURIComponent(order.address);
      Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${encoded}`);
    }
  };

  const handleMarkDelivered = async (order: BagOrder) => {
    const code = await AsyncStorage.getItem('restaurant_code') || '';
    
    await fetch(`${BACKEND_URL}/mark-delivered`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: order.order_id, delivery_name: deliveryName, restaurant_code: code }),
    });

    await fetch(`${BACKEND_URL}/release-claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: order.order_id, restaurant_code: code }),
    });

    // Notify owner that order is completed
    await fetch(`${BACKEND_URL}/status-update`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        restaurant_code: code,
        order_id: order.order_id,
        status: 'completed',
        customer_name: order.customer_name,
        customer_phone: order.customer_phone,
        total: order.total,
        currency: order.currency,
        items: order.items,
        payment_method: order.payment_method,
        shipping: { method: 'Lieferung', address: order.address },
        event_type: 'status_update',
      }),
    });

    const deliveredAt = new Date().toLocaleString();

    const newBag = bag.map(o =>
      o.order_id === order.order_id
        ? { ...o, status: 'delivered' as const, delivered_at: deliveredAt }
        : o
    );

    await saveBag(newBag);

    const historyRecord = {
      order_id: order.order_id,
      customer_name: order.customer_name,
      address: order.address,
      total: order.total,
      currency: order.currency,
      delivered_at: deliveredAt,
    };

    const stored = await AsyncStorage.getItem('delivery_history');
    const history = stored ? JSON.parse(stored) : [];

    await AsyncStorage.setItem(
      'delivery_history',
      JSON.stringify([historyRecord, ...history])
    );
  };

  const handleRemoveFromBag = async (order_id: number) => {
    await fetch(`${BACKEND_URL}/release-claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id, restaurant_code: await AsyncStorage.getItem('restaurant_code') || '' }),
    });

    const newBag = bag.filter(o => o.order_id !== order_id);
    await saveBag(newBag);
  };

  const toggleExpanded = (order_id: number) => {
    setExpandedOrders(prev =>
      prev.includes(order_id)
        ? prev.filter(id => id !== order_id)
        : [order_id]
    );
  };

  const pendingOrders = bag.filter(
    o => o.status === 'pending' || o.status === 'delivering'
  );

  const deliveredOrders = bag.filter(o => o.status === 'delivered');

  const groupedDelivered = groupByDate(deliveredOrders, t);

  const onRefresh = async () => {
    setRefreshing(true);
    await loadBag();
    setRefreshing(false);
  };
  const moveOrder = async (index: number, direction: 'up' | 'down') => {
    const newPending = [...pendingOrders];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;

    if (targetIndex < 0 || targetIndex >= newPending.length) return;

    [newPending[index], newPending[targetIndex]] = [
      newPending[targetIndex],
      newPending[index],
    ];

    await saveBag([...newPending, ...deliveredOrders]);
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Image
          source={require('../../assets/images/logo.png')}
          style={styles.logo}
          resizeMode="contain"
        />
      </View>

      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView
            contentContainerStyle={styles.scrollContent}
            refreshControl={
              <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#111" colors={['#111']} />
            }
          >
          {bag.length === 0 && (
            <View style={styles.empty}>
              <Ionicons name="bag-outline" size={48} color="#D0D0D0" />
              <Text style={styles.emptyText}>{t.bagEmpty}</Text>
              <Text style={styles.emptySubText}>{t.bagEmptySub}</Text>
            </View>
          )}

          {pendingOrders.length > 0 && (
            <>
              <Text style={styles.groupLabel}>{t.activeOrders}</Text>

              {pendingOrders.length > 1 && (
                <Text style={styles.reorderHint}>{t.reorderHint}</Text>
              )}

              {pendingOrders.map((order, index) => {
                const isExpanded = expandedOrders.includes(order.order_id);

                return (
                  <View key={order.order_id} style={styles.section}>
                    <TouchableOpacity
                      style={styles.cardTopRow}
                      onPress={() => toggleExpanded(order.order_id)}
                      activeOpacity={0.7}
                    >
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                          <View style={styles.queueBadge}>
                            <Text style={styles.queueBadgeText}>#{index + 1}</Text>
                          </View>

                          <Text style={styles.cardTitle}>Order #{order.order_id}</Text>
                        </View>

                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Text style={styles.cardSubtitle}>{order.customer_name}</Text>
                          <Text style={{ fontSize: 13, color: '#8B38CB', fontWeight: '600' }}>
                            {order.accepted_time && (order.accepted_time.includes('—') || (order.accepted_time.includes(':') && !order.accepted_time.includes('Minutes')))
                              ? order.accepted_time.split('—')[0].trim()
                              : 'ASAP'}
                          </Text>
                        </View>
                        {order.note && !isExpanded ? (
                          <View style={{ 
                            flexDirection: 'row', 
                            alignItems: 'center', 
                            gap: 4, 
                            marginTop: 4,
                            backgroundColor: '#fffbeb',
                            borderRadius: 6,
                            paddingHorizontal: 8,
                            paddingVertical: 4,
                            borderLeftWidth: 3,
                            borderLeftColor: '#f39c12',
                          }}>
                            <Ionicons name="alert-circle-outline" size={13} color="#f39c12" />
                            <Text style={{ fontSize: 12, color: '#111', fontWeight: '600', flex: 1 }} numberOfLines={1}>{order.note}</Text>
                          </View>
                        ) : null}
                      </View>

                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                        <View style={styles.arrowsCol}>
                          {index > 0 && (
                            <TouchableOpacity
                              onPress={() => moveOrder(index, 'up')}
                              style={styles.arrowBtn}
                            >
                              <Ionicons name="chevron-up-outline" size={22} color="#000000" />
                            </TouchableOpacity>
                          )}

                          {index < pendingOrders.length - 1 && (
                            <TouchableOpacity
                              onPress={() => moveOrder(index, 'down')}
                              style={styles.arrowBtn}
                            >
                              <Ionicons name="chevron-down-outline" size={22} color="#000000" />
                            </TouchableOpacity>
                          )}
                        </View>

                        <View
                          style={[
                            styles.statusBadge,
                            order.status === 'delivering' && styles.statusBadgeDelivering,
                          ]}
                        >
                          <Text
                            style={[
                              styles.statusBadgeText,
                              order.status === 'delivering' && { color: '#f39c12' },
                            ]}
                          >
                            {order.status === 'delivering' ? t.delivering : t.pending || 'Pending'}
                          </Text>
                        </View>

                        <Ionicons
                          name={isExpanded ? 'chevron-up-outline' : 'chevron-down-outline'}
                          size={16}
                          color="#ccc"
                        />
                      </View>
                    </TouchableOpacity>

                    {isExpanded && (
                      <>
                        <View style={styles.divider} />

                        {order.customer_name ? (
                          <View style={styles.row}>
                            <Ionicons name="person-outline" size={16} color="#999" />
                            <Text style={styles.rowValue}>{order.customer_name}</Text>
                          </View>
                        ) : null}

                        {order.customer_phone ? (
                          <TouchableOpacity
                            style={styles.row}
                            onPress={() => Linking.openURL(`tel:${order.customer_phone}`)}
                          >
                            <Ionicons name="call-outline" size={16} color="#999" />
                            <Text style={[styles.rowValue, styles.linkValue]}>
                              {order.customer_phone}
                            </Text>
                          </TouchableOpacity>
                        ) : null}

                        {order.address ? (
                          <View style={styles.row}>
                            <Ionicons name="location-outline" size={16} color="#999" />
                            <Text style={styles.rowValue}>{order.address}</Text>
                          </View>
                        ) : null}

                        {order.total ? (
                          <View style={styles.row}>
                            <Ionicons name="cash-outline" size={16} color="#999" />
                            <Text style={styles.rowValue}>
                              {order.currency} {order.total}
                            </Text>
                          </View>
                        ) : null}

                        {order.payment_method ? (
                          <View style={[styles.row, !order.note ? { borderBottomWidth: 0 } : {}]}>
                            <Ionicons name="card-outline" size={16} color="#999" />
                            <Text style={styles.rowValue}>
                              {order.payment_method?.toLowerCase().includes('bar') ? t.cash : order.payment_method?.toLowerCase().includes('online') ? t.online : order.payment_method}
                            </Text>
                          </View>
                        ) : null}

                        {order.note ? (
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
                              <Text style={{ fontSize: 14, color: '#111', fontWeight: '600', flex: 1 }}>{order.note}</Text>
                            </View>
                          </View>
                        ) : null}

                        {order.items && order.items.length > 0 && (
                          <>
                            <View style={styles.divider} />
                            <Text style={styles.itemsLabel}>{t.items}</Text>

                            {order.items.map((item: any, j: number) => (
                              <Text key={j} style={styles.itemText}>
                                {item.quantity}x {item.name}
                              </Text>
                            ))}
                          </>
                        )}
                      </>
                    )}

                    {order.accepted_time && order.accepted_at ? (
                      (() => {
                        const at = order.accepted_time;
                        const isItemScheduled = at.includes('—') || (at.includes(':') && !at.includes('Minutes'));
                        if (isItemScheduled) {
                          const scheduledStr = at.split('—')[0].trim();
                          const scheduledDateStr = at.split('—')[1]?.trim();
                          const parts = scheduledDateStr?.split('/');
                          const scheduledMs = parts ? new Date(`${parts[2]}-${parts[1]}-${parts[0]}T${scheduledStr}:00`).getTime() : null;
                          if (!scheduledMs) return null;
                          return <ScheduledCountdown scheduledMs={scheduledMs} at={at} />;
                        }
                        return (
                          <CountdownTimer
                            accepted_at={order.accepted_at}
                            accepted_time={at}
                          />
                        );
                      })()
                    ) : null}

                    <View style={styles.divider} />

                    {order.status === 'pending' && (
                      <View style={styles.btnRow}>
                        <TouchableOpacity
                          style={styles.primaryBtn}
                          onPress={() => handleStartDelivering(order)}
                        >
                          <Ionicons
                            name="navigate-outline"
                            size={16}
                            color="#fff"
                            style={{ marginRight: 6 }}
                          />
                          <Text style={styles.primaryBtnText}>{t.startDelivering}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={styles.removeBtn}
                          onPress={() => handleRemoveFromBag(order.order_id)}
                        >
                          <Ionicons name="trash-outline" size={16} color="#999" />
                        </TouchableOpacity>
                      </View>
                    )}

                    {order.status === 'delivering' && (
                      <View style={styles.btnRow}>
                        <TouchableOpacity
                          style={styles.deliveredBtn}
                          onPress={() => handleMarkDelivered(order)}
                        >
                          <Ionicons
                            name="checkmark-outline"
                            size={16}
                            color="#fff"
                            style={{ marginRight: 6 }}
                          />
                          <Text style={styles.deliveredBtnText}>{t.markDelivered}</Text>
                        </TouchableOpacity>

                        <TouchableOpacity
                          style={styles.removeBtn}
                          onPress={() => handleRemoveFromBag(order.order_id)}
                        >
                          <Ionicons name="trash-outline" size={16} color="#999" />
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                );
              })}
            </>
          )}

          {groupedDelivered.map(({ label, orders }) => (
            <View key={label}>
              <Text style={styles.groupLabel}>{label}</Text>

              {orders.map(order => {
                const isExpanded = expandedOrders.includes(order.order_id);

                return (
                  <View key={order.order_id} style={styles.section}>
                    <TouchableOpacity
                    onPress={() => toggleExpanded(order.order_id)}
                    activeOpacity={0.8}
                  >
                    <View style={styles.cardTopRow}>
                      <View>
                        <Text style={styles.cardTitle}>Order #{order.order_id}</Text>
                        <Text style={styles.cardSubtitle}>{order.customer_name}</Text>
                        {order.note ? (
                          <View style={{ 
                            flexDirection: 'row', 
                            alignItems: 'center', 
                            gap: 4, 
                            marginTop: 4,
                            backgroundColor: '#fffbeb',
                            borderRadius: 6,
                            paddingHorizontal: 8,
                            paddingVertical: 4,
                            borderLeftWidth: 3,
                            borderLeftColor: '#f39c12',
                          }}>
                            <Ionicons name="alert-circle-outline" size={13} color="#f39c12" />
                            <Text style={{ fontSize: 12, color: '#111', fontWeight: '600', flex: 1 }} numberOfLines={1}>{order.note}</Text>
                          </View>
                        ) : null}
                      </View>

                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                        <View style={styles.deliveredBadge}>
                          <Text style={styles.deliveredBadgeText}>{t.delivered}</Text>
                        </View>
                        <TouchableOpacity
                          onPress={() => handleRemoveFromBag(order.order_id)}
                          style={styles.removeBtn}
                        >
                          <Ionicons name="trash-outline" size={16} color="#999" />
                        </TouchableOpacity>
                      </View>
                    </View>

                    {isExpanded && (
                      <>
                        <View style={styles.divider} />

                        {order.customer_name ? (
                          <View style={styles.row}>
                            <Ionicons name="person-outline" size={16} color="#999" />
                            <Text style={styles.rowValue}>{order.customer_name}</Text>
                          </View>
                        ) : null}

                        {order.customer_phone ? (
                          <TouchableOpacity
                            style={styles.row}
                            onPress={() => Linking.openURL(`tel:${order.customer_phone}`)}
                          >
                            <Ionicons name="call-outline" size={16} color="#999" />
                            <Text style={[styles.rowValue, styles.linkValue]}>
                              {order.customer_phone}
                            </Text>
                          </TouchableOpacity>
                        ) : null}

                        {order.address ? (
                          <View style={styles.row}>
                            <Ionicons name="location-outline" size={16} color="#999" />
                            <Text style={styles.rowValue}>{order.address}</Text>
                          </View>
                        ) : null}

                        {order.total ? (
                          <View style={[styles.row, { borderBottomWidth: 0 }]}>
                            <Ionicons name="cash-outline" size={16} color="#999" />
                            <Text style={styles.rowValue}>
                              {order.currency} {order.total}
                            </Text>
                          </View>
                        ) : null}

                        {order.delivered_at ? (
                          <>
                            <View style={styles.divider} />
                            <Text style={styles.deliveredTime}>
                              {t.deliveredAt} {order.delivered_at}
                            </Text>
                          </>
                        ) : null}
                      </>
                    )}
                  </TouchableOpacity>
                  </View>
                );
              })}
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
      <CustomAlert
        visible={alertConfig.visible}
        title={alertConfig.title}
        message={alertConfig.message}
        buttons={alertConfig.buttons}
        onClose={() => setAlertConfig(prev => ({ ...prev, visible: false }))}
        icon="warning-outline"
        iconColor="#f39c12"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F7F7' },
  header: {
    backgroundColor: '#fff',
    paddingTop: Platform.OS === 'android' ? 40 : 65,
    paddingBottom: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
    alignItems: 'center',
  },
  logo: { width: 100, height: 30 },
  scrollContent: { paddingBottom: 40, paddingTop: 8 },
  empty: { alignItems: 'center', marginTop: 80, gap: 10 },
  emptyText: { fontSize: 16, fontWeight: '600', color: '#333', marginTop: 8 },
  emptySubText: { fontSize: 14, color: '#999' },
  groupLabel: {
    fontSize: 13,
    fontWeight: '500',
    color: '#666',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 24,
    marginBottom: 8,
    marginHorizontal: 20,
  },
  reorderHint: {
    fontSize: 12,
    color: '#999',
    marginHorizontal: 20,
    marginBottom: 8,
    marginTop: -4,
  },
  section: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 12,
    borderRadius: 14,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: { fontSize: 17, fontWeight: '700', color: '#111' },
  cardSubtitle: { fontSize: 14, color: '#666', marginTop: 7 },
  statusBadge: {
    backgroundColor: '#F5F5F5',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  statusBadgeDelivering: { backgroundColor: '#fffbeb' },
  statusBadgeText: { fontSize: 11, fontWeight: '600', color: '#666' },
  queueBadge: {
    backgroundColor: '#111',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  queueBadgeText: { fontSize: 11, fontWeight: '700', color: '#fff' },
  deliveredBadge: {
    backgroundColor: '#f0fdf4',
    borderRadius: 6,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  deliveredBadgeText: { fontSize: 13, fontWeight: '600', color: '#2ecc71' },
  divider: { height: 1, backgroundColor: '#F0F0F0', marginVertical: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#F5F5F5',
  },
  rowValue: { fontSize: 14, color: '#111', fontWeight: '500', flex: 1 },
  linkValue: { color: '#007AFF' },
  itemsLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 8,
  },
  itemText: { fontSize: 14, color: '#333', marginBottom: 4 },
  btnRow: { flexDirection: 'row', gap: 10, alignItems: 'center' },
  primaryBtn: {
    flex: 1,
    backgroundColor: '#111',
    borderRadius: 10,
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  primaryBtnText: { fontSize: 15, fontWeight: '600', color: '#fff' },
  removeBtn: {
    width: 46,
    height: 46,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E8E8E8',
    justifyContent: 'center',
    alignItems: 'center',
  },
  deliveredBtn: {
    flex: 1,
    backgroundColor: '#2ecc71',
    borderRadius: 10,
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  deliveredBtnText: { fontSize: 15, fontWeight: '600', color: '#fff' },
  deliveredTime: { fontSize: 13, color: '#999', textAlign: 'center' },
  arrowsCol: { flexDirection: 'column', gap: 4 },
  arrowBtn: { padding: 4 },
});