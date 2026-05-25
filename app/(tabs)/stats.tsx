import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import {
  Image, Platform,
  RefreshControl, SafeAreaView, ScrollView,
  StyleSheet, Text, TouchableOpacity, View
} from 'react-native';
import { useLanguage } from '../../lib/useLanguage';

interface Order {
  order_id: number;
  customer_name: string;
  total: string;
  currency: string;
  status: string;
  payment_method: string;
  timestamp: number;
  shipping_method: string;
}

function getStats(orders: Order[], fromDate: Date, toDate?: Date) {
  const filtered = orders.filter(o => {
    const date = new Date(o.timestamp);
    const inRange = toDate ? date >= fromDate && date < toDate : date >= fromDate;
    return inRange && o.status !== 'cancelled';
  });
  const totalOrders = filtered.length;
  const cash = filtered
    .filter(o => o.payment_method?.toLowerCase().includes('bar') || o.payment_method?.toLowerCase().includes('cash'))
    .reduce((sum, o) => sum + parseFloat(o.total || '0'), 0);
  const online = filtered
    .filter(o => !o.payment_method?.toLowerCase().includes('bar') && !o.payment_method?.toLowerCase().includes('cash'))
    .reduce((sum, o) => sum + parseFloat(o.total || '0'), 0);
  const total = cash + online;
  const deliveries = filtered.filter(o => o.shipping_method !== 'Abholung').length;
  const pickups = filtered.filter(o => o.shipping_method === 'Abholung').length;
  return { totalOrders, cash, online, total, deliveries, pickups, currency: filtered[0]?.currency || 'CHF' };
}

function getStartOfDay() {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d;
}
function getStartOfWeek() {
  const d = new Date(); d.setDate(d.getDate() - 7); d.setHours(0, 0, 0, 0); return d;
}
function getStartOfMonth() {
  const d = new Date(); d.setDate(1); d.setHours(0, 0, 0, 0); return d;
}
function getStartOfYear() {
  const d = new Date(); d.setMonth(0, 1); d.setHours(0, 0, 0, 0); return d;
}
function getStartOfPastYear() {
  const d = new Date(); d.setFullYear(d.getFullYear() - 1); d.setMonth(0, 1); d.setHours(0, 0, 0, 0); return d;
}
function getEndOfPastYear() {
  const d = new Date(); d.setMonth(0, 1); d.setHours(0, 0, 0, 0); return d;
}

const BACKEND_URL = 'https://foodup-order-alerts-backend.onrender.com';

export default function StatsScreen() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const fetchAllStats = useCallback(async () => {
    const code = await AsyncStorage.getItem('restaurant_code') || '';
    if (!code) return;
    const [ordersResult, deliveredResult, claimsResult, ordersForClaims] = await Promise.all([
      fetch(`${BACKEND_URL}/orders/${code}`).then(r => r.json()).catch(() => ({})),
      fetch(`${BACKEND_URL}/all-couriers-delivered/${code}`).then(r => r.json()).catch(() => ({})),
      fetch(`${BACKEND_URL}/claims/${code}`).then(r => r.json()).catch(() => ({})),
      fetch(`${BACKEND_URL}/orders/${code}`).then(r => r.json()).catch(() => ({})),
    ]);
    if (ordersResult.success) {
      const validOrders = ordersResult.orders.filter((o: any) => o.date_created).map((o: any) => ({
        order_id: parseInt(o.order_id),
        total: String(o.total || ''),
        currency: o.currency || 'CHF',
        status: o.status || '',
        payment_method: o.payment_method || '',
        timestamp: new Date(o.date_created).getTime(),
        shipping_method: o.shipping?.method || '',
      }));
      setOrders(validOrders);
    }
    if (deliveredResult.success) setCourierDelivered(deliveredResult.couriers);
    if (claimsResult.success && ordersForClaims.success) {
      setAllOrders(ordersForClaims.orders);
      const grouped: { [key: string]: any[] } = {};
      Object.entries(claimsResult.claims).forEach(([orderId, claim]: any) => {
        if (claim.status === 'delivered') return;
        const name = claim.name;
        if (!name) return;
        const order = ordersForClaims.orders.find((o: any) => String(o.order_id) === String(orderId));
        if (!order) return;
        if (!grouped[name]) grouped[name] = [];
        grouped[name].push({
          order_id: parseInt(orderId),
          total: String(order.total || ''),
          currency: order.currency || 'CHF',
          payment_method: order.payment_method || '',
          status: claim.status,
        });
      });
      setCourierClaims(grouped);
    }
  }, []);
  const [courierStats, setCourierStats] = useState<{ [key: string]: { today: number; week: number; total: number } }>({});
  const [courierDelivered, setCourierDelivered] = useState<{ [key: string]: any[] }>({});
  const [courierClaims, setCourierClaims] = useState<{ [key: string]: any[] }>({});
  const [allOrders, setAllOrders] = useState<any[]>([]);
  const [expandedCourier, setExpandedCourier] = useState<string | null>(null);
  const [expandedCourierDay, setExpandedCourierDay] = useState<string | null>(null);
  const [expandedOpenOrders, setExpandedOpenOrders] = useState<string | null>(null);
  const { t } = useLanguage();
  const scrollRef = useRef<any>(null);

useFocusEffect(
    useCallback(() => {
      setTimeout(() => {
        try { scrollRef.current?.scrollTo({ y: 0, animated: true }); } catch (e) {}
      }, 300);
      fetchAllStats();
      const interval = setInterval(fetchAllStats, 15000);
      return () => clearInterval(interval);
    }, [fetchAllStats])
  );
  const toggleExpand = (key: string) => {
    setExpanded(prev => prev === key ? null : key);
  };

  const todayStats = getStats(orders, getStartOfDay());
  const weekStats = getStats(orders, getStartOfWeek());
  const monthStats = getStats(orders, getStartOfMonth());
  const yearStats = getStats(orders, getStartOfYear());
  const pastYearStats = getStats(orders, getStartOfPastYear(), getEndOfPastYear());

  const StatRows = ({ stats }: { stats: any }) => (
    <>
      <View style={styles.row}>
        <Ionicons name="receipt-outline" size={16} color="#999" />
        <Text style={styles.rowLabel}>{t.total} {t.orders}</Text>
        <Text style={styles.rowValue}>{stats.totalOrders}</Text>
      </View>
      <View style={styles.divider} />
      <View style={styles.row}>
        <Ionicons name="bicycle-outline" size={16} color="#999" />
        <Text style={styles.rowLabel}>{t.deliveryLabel}</Text>
        <Text style={styles.rowValue}>{stats.deliveries}</Text>
      </View>
      <View style={styles.divider} />
      <View style={styles.row}>
        <Ionicons name="bag-outline" size={16} color="#999" />
        <Text style={styles.rowLabel}>{t.pickupLabel}</Text>
        <Text style={styles.rowValue}>{stats.pickups}</Text>
      </View>
      <View style={styles.divider} />
      <View style={styles.row}>
        <Ionicons name="cash-outline" size={16} color="#999" />
        <Text style={styles.rowLabel}>{t.cashPayment}</Text>
        <Text style={styles.rowValue}>{stats.currency} {stats.cash.toFixed(2)}</Text>
      </View>
      <View style={styles.divider} />
      <View style={styles.row}>
        <Ionicons name="card-outline" size={16} color="#999" />
        <Text style={styles.rowLabel}>{t.onlinePayment}</Text>
        <Text style={styles.rowValue}>{stats.currency} {stats.online.toFixed(2)}</Text>
      </View>
      <View style={styles.divider} />
      <View style={styles.row}>
        <Ionicons name="trending-up-outline" size={16} color="#999" />
        <Text style={[styles.rowLabel, { fontWeight: '700', color: '#111' }]}>{t.totalRevenue}</Text>
        <Text style={[styles.rowValue, { fontWeight: '700', color: '#111' }]}>{stats.currency} {stats.total.toFixed(2)}</Text>
      </View>
    </>
  );

  const CollapsibleCard = ({ title, statsKey, stats }: { title: string; statsKey: string; stats: any }) => {
    const isOpen = expanded === statsKey;
    return (
      <>
        <Text style={styles.groupLabel}>{title}</Text>
        <View style={styles.section}>
          {!isOpen && (
            <TouchableOpacity
              style={[styles.row, { borderBottomWidth: 0 }]}
              onPress={() => toggleExpand(statsKey)}
            >
              <Ionicons name="bar-chart-outline" size={16} color="#999" />
              <Text style={[styles.rowLabel, { flex: 1 }]}>
                {stats.totalOrders === 0
                  ? t.noOrders
                  : `${stats.totalOrders} ${t.orders} · ${stats.currency} ${stats.total.toFixed(2)}`}
              </Text>
              <Text style={styles.chevron}>▼</Text>
            </TouchableOpacity>
          )}
          {isOpen && (
            <>
              <TouchableOpacity
                style={[styles.row, { borderBottomWidth: 1 }]}
                onPress={() => toggleExpand(statsKey)}
              >
                <Text style={[styles.rowLabel, { flex: 1, fontWeight: '600', color: '#111' }]}>{title}</Text>
                <Text style={styles.chevron}>▲</Text>
              </TouchableOpacity>
              <StatRows stats={stats} />
            </>
          )}
        </View>
      </>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Image source={require('../../assets/images/logo.png')} style={styles.logo} resizeMode="contain" />
      </View>
      <SafeAreaView style={{ flex: 1 }}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scrollContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await fetchAllStats();
                setRefreshing(false);
              }}
              tintColor="#111"
              colors={['#111']}
            />
          }
        >

          <Text style={styles.groupLabel}>{t.today}</Text>
          <View style={styles.section}>
            <StatRows stats={todayStats} />
          </View>

            <CollapsibleCard title={t.thisWeek} statsKey="week" stats={weekStats} />
            <CollapsibleCard title={t.thisMonth} statsKey="month" stats={monthStats} />
            <CollapsibleCard title={t.thisYear} statsKey="year" stats={yearStats} />
            {(Object.keys(courierDelivered).length > 0 || Object.keys(courierClaims).length > 0) && (
            <>
              <Text style={styles.groupLabel}>{t.courierPerformance}</Text>
              {(() => {
                const isCashFn = (pm: string) => pm?.toLowerCase().includes('bar') || pm?.toLowerCase().includes('cash');
                const allCourierNames = Array.from(new Set([
                  ...Object.keys(courierDelivered),
                  ...Object.keys(courierClaims),
                ])).sort((a, b) => {
                  const aCash = (courierDelivered[a] || []).filter((o: any) => isCashFn(o.payment_method)).reduce((s: number, o: any) => s + parseFloat(o.total || '0'), 0)
                    + (courierClaims[a] || []).filter((o: any) => isCashFn(o.payment_method)).reduce((s: number, o: any) => s + parseFloat(o.total || '0'), 0);
                  const bCash = (courierDelivered[b] || []).filter((o: any) => isCashFn(o.payment_method)).reduce((s: number, o: any) => s + parseFloat(o.total || '0'), 0)
                    + (courierClaims[b] || []).filter((o: any) => isCashFn(o.payment_method)).reduce((s: number, o: any) => s + parseFloat(o.total || '0'), 0);
                  return bCash - aCash;
                });
                return allCourierNames.map(name => {
                const orders = courierDelivered[name] || [];
                const isOpen = expandedCourier === name;
                const today = new Date(); today.setHours(0, 0, 0, 0);
                const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
                const day2 = new Date(today); day2.setDate(today.getDate() - 2);
                const day3 = new Date(today); day3.setDate(today.getDate() - 3);
                const last20Start = new Date(today); last20Start.setDate(today.getDate() - 23);
                const last20End = new Date(today); last20End.setDate(today.getDate() - 4);

                const isCash = (pm: string) => pm?.toLowerCase().includes('bar') || pm?.toLowerCase().includes('cash');
                const formatDate = (d: Date) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;

                const makeDayGroup = (label: string, from: Date, to?: Date, dateRange?: string) => {
                  const filtered = orders.filter((o: any) => {
                    let d = new Date(o.delivered_at);
                    if (isNaN(d.getTime())) {
                      const parts = (o.delivered_at || '').match(/(\d+)\/(\d+)\/(\d+)/);
                      if (parts) d = new Date(`${parts[3]}-${parts[1].padStart(2,'0')}-${parts[2].padStart(2,'0')}`);
                    }
                    d.setHours(0,0,0,0);
                    if (to) return d >= from && d < to;
                    return d.getTime() === from.getTime();
                  });
                  const cashOrders = filtered.filter((o: any) => isCash(o.payment_method));
                  const totalCash = cashOrders.reduce((sum: number, o: any) => sum + parseFloat(o.total || '0'), 0);
                  return { label, dateRange, orders: filtered, cashOrders, totalCash, currency: filtered[0]?.currency || 'CHF' };
                };

                const groups = [
                  makeDayGroup('Today', today),
                  makeDayGroup('Yesterday', yesterday),
                  makeDayGroup(day2.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'short' }), day2),
                  makeDayGroup(day3.toLocaleDateString('en-GB', { weekday: 'long', day: '2-digit', month: 'short' }), day3),
                  makeDayGroup('Last 20 Days', last20Start, last20End, `${formatDate(last20Start)} - ${formatDate(last20End)}`),
                ].filter(g => g.orders.length > 0);

                const totalOrders = orders.length;
                const totalCashAll = orders.filter((o: any) => isCash(o.payment_method)).reduce((sum: number, o: any) => sum + parseFloat(o.total || '0'), 0);
                const currency = orders[0]?.currency || 'CHF';

                return (
                  <View key={name} style={[styles.section, { marginBottom: 10 }]}>
                    <TouchableOpacity
                      style={[styles.row, { borderBottomWidth: isOpen ? 1 : 0 }]}
                      onPress={() => {
                        const opening = !isOpen;
                        setExpandedCourier(opening ? name : null);
                        setExpandedCourierDay(opening ? `${name}-0` : null);
                      }}
                    >
                      <Ionicons name="bicycle-outline" size={16} color={isOpen ? '#8B38CB' : '#999'} />
                      <Text style={[styles.rowLabel, { fontWeight: '700', color: isOpen ? '#8B38CB' : '#111' }]}>{name}</Text>
                      {!isOpen && (() => {
                        const inProgress = courierClaims[name] || [];
                        const inProgressCash = inProgress.filter((o: any) => isCash(o.payment_method));
                        const inProgressCashTotal = inProgressCash.reduce((sum: number, o: any) => sum + parseFloat(o.total || '0'), 0);
                        return (
                          <View style={{ alignItems: 'flex-end' }}>
                            <Text style={{ fontSize: 12, color: '#666' }}>{totalOrders} {t.delivered || 'delivered'} · {currency} {totalCashAll.toFixed(2)}</Text>
                            {inProgress.length > 0 && (
                              <Text style={{ fontSize: 12, color: '#f39c12', fontWeight: '600' }}>{inProgress.length} {t.openOrders || 'open'} · {currency} {inProgressCashTotal.toFixed(2)}</Text>
                            )}
                            <Text style={{ fontSize: 12, color: '#111', fontWeight: '700', marginTop: 2 }}>
                              {t.total || 'Total'}: {currency} {(totalCashAll + inProgressCashTotal).toFixed(2)}
                            </Text>
                          </View>
                        );
                      })()}
                      <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} color={isOpen ? '#8B38CB' : '#999'} />
                    </TouchableOpacity>

                    {isOpen && (
                      <>
                        {(() => {
                          const inProgress = courierClaims[name] || [];
                          const inProgressCash = inProgress.filter((o: any) => isCash(o.payment_method));
                          const inProgressCashTotal = inProgressCash.reduce((sum: number, o: any) => sum + parseFloat(o.total || '0'), 0);
                          if (inProgress.length === 0) return null;
                          const openOrders = expandedOpenOrders === name;
                          return (
                            <View style={{ marginHorizontal: -20, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' }}>
                              <TouchableOpacity
                                style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingVertical: 10, backgroundColor: '#fffbeb' }}
                                onPress={() => setExpandedOpenOrders(openOrders ? null : name)}
                              >
                                <Ionicons name="time-outline" size={13} color="#f39c12" />
                                <View style={{ flex: 1, marginLeft: 6 }}>
                                  <Text style={{ fontSize: 12, fontWeight: '700', color: '#f39c12' }}>
                                    {t.openOrders || 'Open Orders'} · {inProgress.length} · {inProgressCash[0]?.currency || 'CHF'} {inProgressCashTotal.toFixed(2)}
                                  </Text>
                                </View>
                                <Ionicons name={openOrders ? 'chevron-up' : 'chevron-down'} size={13} color="#f39c12" />
                              </TouchableOpacity>
                              {openOrders && (
                                <View style={{ backgroundColor: '#fffbeb', paddingHorizontal: 8, paddingBottom: 8 }}>
                                  {inProgress.map((o: any, oi: number) => (
                                    <View key={o.order_id} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 5, borderBottomWidth: oi === inProgress.length - 1 ? 0 : 1, borderBottomColor: '#fde68a' }}>
                                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                                        <Text style={{ fontSize: 13, color: '#666' }}>#{o.order_id}</Text>
                                        <View style={{ backgroundColor: o.status === 'delivering' ? '#fff3e0' : '#e3f2fd', borderRadius: 4, paddingHorizontal: 6, paddingVertical: 2 }}>
                                          <Text style={{ fontSize: 11, fontWeight: '600', color: o.status === 'delivering' ? '#f39c12' : '#2980b9' }}>
                                            {o.status === 'delivering' ? (t.delivering || 'Delivering') : (t.inBag || 'In Bag')}
                                          </Text>
                                        </View>
                                      </View>
                                      {isCash(o.payment_method) ? (
                                        <Text style={{ fontSize: 13, color: '#e74c3c', fontWeight: '600' }}>{o.currency} {parseFloat(o.total).toFixed(2)}</Text>
                                      ) : (
                                        <Text style={{ fontSize: 13, color: '#999' }}>Online</Text>
                                      )}
                                    </View>
                                  ))}
                                  {inProgressCash.length > 0 && (
                                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 6, marginTop: 4, borderTopWidth: 1.5, borderTopColor: '#f39c12' }}>
                                      <Text style={{ fontSize: 12, fontWeight: '700', color: '#f39c12' }}>{t.unconfirmedCash || 'Unconfirmed Cash'}</Text>
                                      <Text style={{ fontSize: 12, fontWeight: '700', color: '#f39c12' }}>{inProgressCash[0]?.currency} {inProgressCashTotal.toFixed(2)}</Text>
                                    </View>
                                  )}
                                </View>
                              )}
                            </View>
                          );
                        })()}
                        {groups.length === 0 ? (
                          <View style={{ paddingVertical: 16, alignItems: 'center' }}>
                            <Text style={{ fontSize: 13, color: '#999' }}>No deliveries yet</Text>
                            <Text style={{ fontSize: 13, color: '#999', marginTop: 4 }}>Total Orders: 0 · Total Cash: {currency} 0.00</Text>
                          </View>
                        ) : (
                          groups.map((group, gi) => {
                            const dayKey = `${name}-${gi}`;
                            const isDayOpen = expandedCourierDay === dayKey;
                            return (
                              <View key={gi}>
                                <TouchableOpacity
                                  style={[styles.row, { borderBottomWidth: isDayOpen ? 1 : 0, paddingLeft: 8 }]}
                                  onPress={() => setExpandedCourierDay(isDayOpen ? null : dayKey)}
                                >
                                  <View style={{ flex: 1 }}>
                                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                                      <Text style={{ fontSize: 14, fontWeight: '600', color: '#111' }}>{group.label}</Text>
                                      {group.dateRange && <Text style={{ fontSize: 11, color: '#999' }}>{group.dateRange}</Text>}
                                    </View>
                                    <Text style={{ fontSize: 12, color: '#666' }}>
                                      {group.orders.length} orders · {group.cashOrders.length} cash · {group.currency} {group.totalCash.toFixed(2)}
                                    </Text>
                                  </View>
                                  <Ionicons name={isDayOpen ? 'chevron-up' : 'chevron-down'} size={14} color="#999" />
                                </TouchableOpacity>
                                {isDayOpen && (
                                  <View style={{ paddingLeft: 8, paddingBottom: 8 }}>
                                    {group.cashOrders.length === 0 ? (
                                      <Text style={{ fontSize: 13, color: '#999', paddingVertical: 8 }}>No cash orders</Text>
                                    ) : (
                                      <>
                                        {group.cashOrders.map((order: any) => (
                                          <View key={order.order_id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#F5F5F5' }}>
                                            <Text style={{ fontSize: 13, color: '#666' }}>#{order.order_id}</Text>
                                            <Text style={{ fontSize: 13, color: '#111', fontWeight: '600' }}>{order.currency} {parseFloat(order.total).toFixed(2)}</Text>
                                          </View>
                                        ))}
                                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 8, borderTopWidth: 1.5, borderTopColor: '#111', marginTop: 4 }}>
                                          <Text style={{ fontSize: 13, fontWeight: '700', color: '#111' }}>Total Cash</Text>
                                          <Text style={{ fontSize: 13, fontWeight: '700', color: '#8B38CB' }}>{group.currency} {group.totalCash.toFixed(2)}</Text>
                                        </View>
                                      </>
                                    )}
                                  </View>
                                )}
                              </View>
                            );
                          })
                        )}
                      </>
                    )}
                  </View>
                );
              });
              })()}
            </>
          )}

        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F7F7F7' },
  header: { backgroundColor: '#fff', paddingTop: Platform.OS === 'android' ? 40 : 65, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: '#F0F0F0', alignItems: 'center' },
  logo: { width: 100, height: 30 },
  scrollContent: { paddingBottom: 40, paddingTop: 8 },
  groupLabel: { fontSize: 13, fontWeight: '500', color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 24, marginBottom: 8, marginHorizontal: 20 },
  section: { backgroundColor: '#fff', marginHorizontal: 16, borderRadius: 14, paddingHorizontal: 20, paddingVertical: 6, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  divider: { height: 1, backgroundColor: '#F0F0F0', marginVertical: 0 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  rowLabel: { fontSize: 14, color: '#666', flex: 1 },
  rowValue: { fontSize: 14, color: '#111', fontWeight: '500' },
  chevron: { fontSize: 12, color: '#999' },
});