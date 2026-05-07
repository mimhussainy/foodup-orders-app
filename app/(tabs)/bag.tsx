import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Image, Linking, SafeAreaView, ScrollView,
  StyleSheet, Text, TouchableOpacity, View
} from 'react-native';
import { useLanguage } from '../../lib/useLanguage';

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
  const { t } = useLanguage();

  useFocusEffect(
    useCallback(() => {
      loadBag();
      AsyncStorage.getItem('delivery_name').then(n => setDeliveryName(n || ''));
    }, [])
  );

  const loadBag = async () => {
    const stored = await AsyncStorage.getItem('delivery_bag');
    if (stored) setBag(JSON.parse(stored));
    else setBag([]);
  };

  const saveBag = async (newBag: BagOrder[]) => {
    setBag(newBag);
    await AsyncStorage.setItem('delivery_bag', JSON.stringify(newBag));
  };

  const handleStartDelivering = async (order: BagOrder) => {
    const newBag = bag.map(o =>
      o.order_id === order.order_id ? { ...o, status: 'delivering' as const } : o
    );

    await saveBag(newBag);

    if (order.address) {
      const encoded = encodeURIComponent(order.address);
      Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${encoded}`);
    }
  };

  const handleMarkDelivered = async (order: BagOrder) => {
    await fetch(`${BACKEND_URL}/mark-delivered`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: order.order_id, delivery_name: deliveryName, restaurant_code: await AsyncStorage.getItem('restaurant_code') || '' }),
    });

    await fetch(`${BACKEND_URL}/release-claim`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ order_id: order.order_id, restaurant_code: await AsyncStorage.getItem('restaurant_code') || '' }),
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
        <ScrollView contentContainerStyle={styles.scrollContent}>
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

                        <Text style={styles.cardSubtitle}>{order.customer_name}</Text>
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
                            {order.status === 'delivering' ? t.delivering : 'Pending'}
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
                          <View style={[styles.row, { borderBottomWidth: 0 }]}>
                            <Ionicons name="card-outline" size={16} color="#999" />
                            <Text style={styles.rowValue}>{order.payment_method}</Text>
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
                  <TouchableOpacity
                    key={order.order_id}
                    style={styles.section}
                    onPress={() => toggleExpanded(order.order_id)}
                    activeOpacity={0.8}
                  >
                    <View style={styles.cardTopRow}>
                      <View>
                        <Text style={styles.cardTitle}>Order #{order.order_id}</Text>
                        <Text style={styles.cardSubtitle}>{order.customer_name}</Text>
                      </View>

                      <View style={styles.deliveredBadge}>
                        <Text style={styles.deliveredBadgeText}>{t.delivered}</Text>
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
                );
              })}
            </View>
          ))}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F7F7' },
  header: {
    backgroundColor: '#fff',
    paddingTop: 70,
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