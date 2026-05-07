import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  AppState,
  Image,
  Linking,
  RefreshControl,
  SafeAreaView,
  ScrollView,
  SectionList,
  StyleSheet,
  Text, TouchableOpacity,
  View
} from 'react-native';
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

export default function OrdersScreen() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const { t } = useLanguage();
  const router = useRouter();

  useEffect(() => {
    AsyncStorage.getItem('user_role').then(r => {
      setRole(r);
      if (r === 'delivery') router.replace('/(tabs)/delivery');
    });
    AsyncStorage.getItem(STORAGE_KEY).then(stored => {
      if (stored) setOrders(JSON.parse(stored));
    });
    fetchOrdersFromBackend();

    const appStateSubscription = AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active') {
        fetchOrdersFromBackend();
      }
    });

    return () => appStateSubscription.remove();
  }, []);

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
          date: new Date().toLocaleString(),
          timestamp: Date.now(),
          shipping_method: o.shipping?.method || '',
          shipping_address: o.shipping?.address || '',
          restaurant_code: o.restaurant_code || '',
        }));
        setOrders(prev => {
          // Merge backend orders with local orders, avoid duplicates
          const merged = [...prev];
          backendOrders.forEach(bo => {
            const exists = merged.findIndex(o => o.order_id === bo.order_id);
            if (exists === -1) merged.push(bo);
          });
          merged.sort((a, b) => b.order_id - a.order_id);
          AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
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
        date: new Date().toLocaleString(),
        timestamp: Date.now(),
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
        }
      });
      return () => subscription.remove();
    }, []);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchOrdersFromBackend();
    setRefreshing(false);
  };

  const sections = groupOrdersByDate(orders, t);

  if (role === 'delivery') return null;

  if (selectedOrder) {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setSelectedOrder(null)} style={styles.backCircle}>
            <Text style={styles.backArrow}>‹</Text>
          </TouchableOpacity>
          <Image source={require('../../assets/images/logo.png')} style={styles.logo} resizeMode="contain" />
          <View style={styles.headerPlaceholder} />
        </View>

        <SafeAreaView style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.scrollContent}>
            <View style={styles.detailTitleRow}>
              <Text style={styles.detailOrderId}>Order #{selectedOrder.order_id}</Text>
              <View style={[styles.statusBadge, { backgroundColor: getStatusColor(selectedOrder.status) + '20' }]}>
                <Text style={[styles.statusBadgeText, { color: getStatusColor(selectedOrder.status) }]}>
                  {getStatusLabel(selectedOrder.status, t)}
                </Text>
              </View>
            </View>
            <Text style={styles.detailDate}>{selectedOrder.date}</Text>

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
                  <Text style={styles.rowValue}>{selectedOrder.payment_method}</Text>
                </View>
              ) : null}
              {selectedOrder.shipping_method ? (
                <View style={[styles.row, !selectedOrder.shipping_address && !selectedOrder.note && { borderBottomWidth: 0 }]}>
                  <Ionicons name="bicycle-outline" size={16} color="#999" />
                  <Text style={styles.rowValue}>{selectedOrder.shipping_method}</Text>
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
                  <Ionicons name="document-text-outline" size={16} color="#999" />
                  <Text style={styles.rowValue}>{selectedOrder.note}</Text>
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
        {orders.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="receipt-outline" size={48} color="#D0D0D0" />
            <Text style={styles.emptyText}>{t.noOrders}</Text>
            <Text style={styles.emptySubText}>{t.noOrdersSub}</Text>
          </View>
        ) : (
          <SectionList
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
                  <View style={[styles.statusPill, { backgroundColor: getStatusColor(item.status) + '20' }]}>
                    <Text style={[styles.statusPillText, { color: getStatusColor(item.status) }]}>
                      {getStatusLabel(item.status, t)}
                    </Text>
                  </View>
                </View>
                <View style={styles.divider} />
                <View style={styles.orderNameRow}>
                  <Text style={styles.orderCustomer}>{item.customer_name}</Text>
                  <Text style={styles.orderDate}>{item.date}</Text>
                </View>
                <View style={styles.orderMeta}>
                  <Ionicons name="cash-outline" size={14} color="#999" />
                  <Text style={styles.orderTotal}>{item.currency} {item.total}</Text>
                </View>
                {item.shipping_method ? (
                  <View style={styles.orderMeta}>
                    <Ionicons name={item.shipping_method === 'Abholung' ? 'bag-outline' : 'bicycle-outline'} size={14} color="#999" />
                    <Text style={styles.orderShipping}>{item.shipping_method}</Text>
                  </View>
                ) : null}
              </TouchableOpacity>
            )}
          />
        )}
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F7F7' },
  header: { backgroundColor: '#fff', paddingTop: 70, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#F0F0F0', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16 },
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
  
  
});