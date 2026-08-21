import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AppState,
  Image, Keyboard, Platform,
  RefreshControl, SafeAreaView, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, TouchableWithoutFeedback, View
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

interface StatsPeriod {
  totalOrders: number;
  cash: number;
  online: number;
  total: number;
  deliveries: number;
  pickups: number;
  currency: string;
}

interface CompactStatsPeriod {
  totalOrders: number;
  cash: number;
  online: number;
  total: number;
  deliveries: number;
  pickups: number;
}

interface CompactStatsOrder {
  order_id: number | string;
  total: number | string;
}

interface CompactStatsCourier {
  name: string;
  currency: string;
  todayCashTotal: number;
  inProgressCashTotal: number;
  totalOwed: number;
  legacySortTotal: number;
  openOrderCount: number;
  openCashOrders: CompactStatsOrder[];
  todayDeliveredCashOrders: CompactStatsOrder[];
}

interface CompactStatsResponse {
  success: true;
  currency: string;
  periods: {
    today: CompactStatsPeriod;
    week: CompactStatsPeriod;
    month: CompactStatsPeriod;
    year: CompactStatsPeriod;
    previousYear: CompactStatsPeriod;
  };
  couriers: CompactStatsCourier[];
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
  const d = new Date();
  const day = d.getDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  const diff = day === 0 ? 6 : day - 1; // days since most recent Monday
  d.setDate(d.getDate() - diff);
  d.setHours(0, 0, 0, 0);
  return d;
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

const PIN_UNLOCK_MS = 5 * 60 * 1000;
const STATS_POLL_INTERVAL_MS = 60 * 1000;
const STATS_REQUEST_TIMEOUT_MS = 8000;
let lastUnlockedAt: number | null = null;

function isFiniteNumber(value: any): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isCompactStatsPeriod(value: any): value is CompactStatsPeriod {
  return !!value
    && isFiniteNumber(value.totalOrders)
    && isFiniteNumber(value.cash)
    && isFiniteNumber(value.online)
    && isFiniteNumber(value.total)
    && isFiniteNumber(value.deliveries)
    && isFiniteNumber(value.pickups);
}

function isCompactStatsOrder(value: any): value is CompactStatsOrder {
  return !!value
    && (typeof value.order_id === 'number' || typeof value.order_id === 'string')
    && (typeof value.total === 'number' || typeof value.total === 'string')
    && Number.isFinite(parseFloat(String(value.total || '0')));
}

function validateCompactStatsResponse(value: any): CompactStatsResponse {
  if (!value || value.success !== true) throw new Error('Invalid stats response');
  if (typeof value.currency !== 'string' || !value.currency) throw new Error('Invalid stats currency');
  if (!value.periods
    || !isCompactStatsPeriod(value.periods.today)
    || !isCompactStatsPeriod(value.periods.week)
    || !isCompactStatsPeriod(value.periods.month)
    || !isCompactStatsPeriod(value.periods.year)
    || !isCompactStatsPeriod(value.periods.previousYear)) {
    throw new Error('Invalid stats periods');
  }
  if (!Array.isArray(value.couriers)) throw new Error('Invalid stats couriers');

  value.couriers.forEach((courier: any) => {
    if (!courier || typeof courier.name !== 'string' || !courier.name) throw new Error('Invalid courier name');
    if (typeof courier.currency !== 'string' || !courier.currency) throw new Error('Invalid courier currency');
    if (!isFiniteNumber(courier.todayCashTotal)
      || !isFiniteNumber(courier.inProgressCashTotal)
      || !isFiniteNumber(courier.totalOwed)
      || !isFiniteNumber(courier.legacySortTotal)
      || !isFiniteNumber(courier.openOrderCount)) {
      throw new Error('Invalid courier totals');
    }
    if (!Array.isArray(courier.openCashOrders)
      || !Array.isArray(courier.todayDeliveredCashOrders)
      || !courier.openCashOrders.every(isCompactStatsOrder)
      || !courier.todayDeliveredCashOrders.every(isCompactStatsOrder)) {
      throw new Error('Invalid courier orders');
    }
  });

  return value as CompactStatsResponse;
}

async function fetchJsonWithTimeout(url: string, timeoutMs: number) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function buildStatsQuery() {
  return [
    `now=${Date.now()}`,
    `today_start=${getStartOfDay().getTime()}`,
    `week_start=${getStartOfWeek().getTime()}`,
    `month_start=${getStartOfMonth().getTime()}`,
    `year_start=${getStartOfYear().getTime()}`,
    `previous_year_start=${getStartOfPastYear().getTime()}`,
  ].join('&');
}

function withStatsCurrency(period: CompactStatsPeriod, currency: string): StatsPeriod {
  return { ...period, currency };
}

export default function StatsScreen() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [pinUnlocked, setPinUnlocked] = useState(false);
  const [pinInput, setPinInput] = useState('');
  const [pinError, setPinError] = useState('');
  const [isFocused, setIsFocused] = useState(false);
  const [appState, setAppState] = useState(AppState.currentState);
  const [statsPeriods, setStatsPeriods] = useState<{
    today: StatsPeriod;
    week: StatsPeriod;
    month: StatsPeriod;
    year: StatsPeriod;
    previousYear: StatsPeriod;
  } | null>(null);
  const [compactCouriers, setCompactCouriers] = useState<CompactStatsCourier[] | null>(null);
  const fetchLegacyStats = useCallback(async (code: string) => {
    const [ordersResult, deliveredResult, claimsResult] = await Promise.all([
      fetch(`${BACKEND_URL}/orders/${code}`).then(r => r.json()).catch(() => ({})),
      fetch(`${BACKEND_URL}/all-couriers-delivered/${code}`).then(r => r.json()).catch(() => ({})),
      fetch(`${BACKEND_URL}/claims/${code}`).then(r => r.json()).catch(() => ({})),
    ]);
    const ordersForClaims = ordersResult;
    if (ordersResult.success) {
      const validOrders = ordersResult.orders.filter((o: any) => o.received_at || o.date_created).map((o: any) => ({
        order_id: parseInt(o.order_id),
        total: String(o.total || ''),
        currency: o.currency || 'CHF',
        status: o.status || '',
        payment_method: o.payment_method || '',
        timestamp: new Date(o.received_at || o.date_created).getTime(),
        shipping_method: o.shipping?.method || '',
      }));
      setOrders(validOrders);
    }
    if (deliveredResult.success) setCourierDelivered(deliveredResult.couriers);
    setStatsPeriods(null);
    setCompactCouriers(null);
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
  const fetchCompactStats = useCallback(async (code: string) => {
    const result = validateCompactStatsResponse(
      await fetchJsonWithTimeout(`${BACKEND_URL}/stats/${code}?${buildStatsQuery()}`, STATS_REQUEST_TIMEOUT_MS)
    );

    setStatsPeriods({
      today: withStatsCurrency(result.periods.today, result.currency),
      week: withStatsCurrency(result.periods.week, result.currency),
      month: withStatsCurrency(result.periods.month, result.currency),
      year: withStatsCurrency(result.periods.year, result.currency),
      previousYear: withStatsCurrency(result.periods.previousYear, result.currency),
    });

    setCompactCouriers([...result.couriers].sort((a, b) => b.legacySortTotal - a.legacySortTotal));
    setOrders([]);
    setCourierDelivered({});
    setCourierClaims({});
    setAllOrders([]);
  }, []);
  const fetchAllStats = useCallback(async () => {
    const code = await AsyncStorage.getItem('restaurant_code') || '';
    if (!code) return;

    try {
      await fetchCompactStats(code);
    } catch (e) {
      await fetchLegacyStats(code);
    }
  }, [fetchCompactStats, fetchLegacyStats]);
  const [courierStats, setCourierStats] = useState<{ [key: string]: { today: number; week: number; total: number } }>({});
  const [courierDelivered, setCourierDelivered] = useState<{ [key: string]: any[] }>({});
  const [courierClaims, setCourierClaims] = useState<{ [key: string]: any[] }>({});
  const [allOrders, setAllOrders] = useState<any[]>([]);
  const [expandedCourier, setExpandedCourier] = useState<string | null>(null);
  const [expandedCourierDay, setExpandedCourierDay] = useState<string | null>(null);
  const [expandedOpenOrders, setExpandedOpenOrders] = useState<string | null>(null);
  const { t } = useLanguage();
  const scrollRef = useRef<any>(null);
  const pinInputRef = useRef<TextInput>(null);

useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      const now = Date.now();
      if (lastUnlockedAt && now - lastUnlockedAt < PIN_UNLOCK_MS) {
        setPinUnlocked(true);
      } else {
        setPinUnlocked(false);
        setPinInput('');
        setPinError('');
        setTimeout(() => {
          pinInputRef.current?.focus();
        }, 300);
      }
      setTimeout(() => {
        try { scrollRef.current?.scrollTo({ y: 0, animated: true }); } catch (e) {}
      }, 300);
      return () => {
        setIsFocused(false);
      };
    }, [])
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', setAppState);
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!isFocused || !pinUnlocked || appState !== 'active') return;

    fetchAllStats();
    const interval = setInterval(fetchAllStats, STATS_POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [appState, fetchAllStats, isFocused, pinUnlocked]);

  const handlePinSubmit = async () => {
    try {
      const code = await AsyncStorage.getItem('restaurant_code') || '';
      const res = await fetch(`${BACKEND_URL}/verify-ios-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ios_pin: pinInput, restaurant_code: code }),
      });
      const result = await res.json();
      if (result.success) {
        lastUnlockedAt = Date.now();
        setPinUnlocked(true);
        setPinError('');
      } else {
        setPinError(result.message || 'Incorrect PIN');
        setPinInput('');
      }
    } catch (e) {
      setPinError('Connection error');
      setPinInput('');
    }
  };
  const toggleExpand = (key: string) => {
    setExpanded(prev => prev === key ? null : key);
  };

  const todayStats = statsPeriods?.today || getStats(orders, getStartOfDay());
  const weekStats = statsPeriods?.week || getStats(orders, getStartOfWeek());
  const monthStats = statsPeriods?.month || getStats(orders, getStartOfMonth());
  const yearStats = statsPeriods?.year || getStats(orders, getStartOfYear());
  const pastYearStats = statsPeriods?.previousYear || getStats(orders, getStartOfPastYear(), getEndOfPastYear());

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

  if (!pinUnlocked) {
    return (
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Image source={require('../../assets/images/logo.png')} style={styles.logo} resizeMode="contain" />
        </View>
        <View style={{ flex: 1, paddingTop: Platform.OS === 'ios' ? 40 : 24, paddingHorizontal: 16 }}>
          <Ionicons name="lock-closed-outline" size={48} color="#8B38CB" style={{ marginBottom: 16, alignSelf: 'center' }} />
          <Text style={{ fontSize: 20, fontWeight: '700', color: '#111', marginBottom: 8, textAlign: 'center', width: '100%' }}>{t.tabStatistics}</Text>
          <Text style={{ fontSize: 14, color: '#999', marginBottom: 24, textAlign: 'center' }}>{t.enterPin}</Text>
          <View style={{ flexDirection: 'row', gap: 10, marginBottom: 12 }}>
            <View style={{ flex: 1, borderWidth: 1, borderColor: '#E8E8E8', borderRadius: 12, backgroundColor: '#FAFAFA' }}>
              <TextInput
                ref={pinInputRef}
                style={{ fontSize: 24, color: '#111', textAlign: 'center', letterSpacing: 8, padding: 16, height: Platform.OS === 'android' ? 56 : undefined }}
                placeholder=""
                keyboardType="numeric"
                secureTextEntry
                maxLength={10}
                value={pinInput}
                onChangeText={(text) => {
                  setPinInput(text);
                  setPinError('');
                }}
                onSubmitEditing={handlePinSubmit}
              />
            </View>
            <TouchableOpacity
              style={{ backgroundColor: '#111', borderRadius: 12, width: 52, height: Platform.OS === 'android' ? 56 : 58, justifyContent: 'center', alignItems: 'center' }}
              onPress={handlePinSubmit}
            >
              <Ionicons name="arrow-forward" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
          {pinError ? <Text style={{ color: '#e74c3c', marginBottom: 12 }}>{pinError}</Text> : null}
        </View>
      </View>
      </TouchableWithoutFeedback>
    );
  }

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
            {((compactCouriers !== null && compactCouriers.length > 0) || (compactCouriers === null && (Object.keys(courierDelivered).length > 0 || Object.keys(courierClaims).length > 0))) && (
            <>
              <Text style={styles.groupLabel}>{t.courierPerformance}</Text>
              {compactCouriers !== null ? (
                compactCouriers.map(courier => {
                const name = courier.name;
                const isOpen = expandedCourier === name;
                const currency = courier.currency || 'CHF';
                const openCashOrders = courier.openCashOrders || [];
                const todayCashOrders = courier.todayDeliveredCashOrders || [];
                const todayCashTotal = courier.todayCashTotal;
                const inProgressCashTotal = courier.inProgressCashTotal;
                const totalOwed = courier.totalOwed;

                return (
                  <View key={name} style={[styles.section, { marginBottom: 10 }]}>
                    <TouchableOpacity
                      style={[styles.row, { borderBottomWidth: isOpen ? 1 : 0 }]}
                      onPress={() => setExpandedCourier(isOpen ? null : name)}
                    >
                      <Ionicons name="bicycle-outline" size={16} color={isOpen ? '#8B38CB' : '#999'} />
                      <Text style={[styles.rowLabel, { fontWeight: '700', color: isOpen ? '#8B38CB' : '#111' }]}>{name}</Text>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: totalOwed > 0 ? '#e74c3c' : '#2ecc71' }}>
                          {t.total || 'Total'}: {currency} {totalOwed.toFixed(2)}
                        </Text>
                      </View>
                      <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} color={isOpen ? '#8B38CB' : '#999'} />
                    </TouchableOpacity>

                    {isOpen && (
                      <>
                        {/* In Progress / Open Orders */}
                        {courier.openOrderCount > 0 && (
                          <View style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' }}>
                            <Text style={{ fontSize: 11, fontWeight: '700', color: '#f39c12', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                              {t.openOrders || 'Open Orders'}
                            </Text>
                            {openCashOrders.map((o: CompactStatsOrder, oi: number) => (
                              <View key={o.order_id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: oi === openCashOrders.length - 1 ? 0 : 1, borderBottomColor: '#F5F5F5' }}>
                                <Text style={{ fontSize: 13, color: '#666' }}>#{o.order_id}</Text>
                                <Text style={{ fontSize: 13, color: '#f39c12', fontWeight: '600' }}>{currency} {parseFloat(String(o.total)).toFixed(2)}</Text>
                              </View>
                            ))}
                            {openCashOrders.length === 0 && (
                              <Text style={{ fontSize: 13, color: '#999' }}>{t.noCashInProgress || 'No cash orders in progress'}</Text>
                            )}
                            {openCashOrders.length > 0 && (
                              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 6, marginTop: 4, borderTopWidth: 1, borderTopColor: '#f39c12' }}>
                                <Text style={{ fontSize: 12, fontWeight: '700', color: '#f39c12' }}>{t.unconfirmedCash || 'Unconfirmed Cash'}</Text>
                                <Text style={{ fontSize: 12, fontWeight: '700', color: '#f39c12' }}>{currency} {inProgressCashTotal.toFixed(2)}</Text>
                              </View>
                            )}
                          </View>
                        )}

                        {/* Today Delivered Cash */}
                        <View style={{ paddingVertical: 10 }}>
                          <Text style={{ fontSize: 11, fontWeight: '700', color: '#8B38CB', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                            {t.today} — {t.delivered || 'Delivered'}
                          </Text>
                          {todayCashOrders.length === 0 ? (
                            <Text style={{ fontSize: 13, color: '#999' }}>{t.noDeliveriesToday || 'No cash deliveries today'}</Text>
                          ) : (
                            <>
                              {todayCashOrders.map((o: CompactStatsOrder, oi: number) => (
                                <View key={o.order_id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: oi === todayCashOrders.length - 1 ? 0 : 1, borderBottomColor: '#F5F5F5' }}>
                                  <Text style={{ fontSize: 13, color: '#666' }}>#{o.order_id}</Text>
                                  <Text style={{ fontSize: 13, color: '#111', fontWeight: '600' }}>{currency} {parseFloat(String(o.total)).toFixed(2)}</Text>
                                </View>
                              ))}
                              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 6, marginTop: 4, borderTopWidth: 1.5, borderTopColor: '#111' }}>
                                <Text style={{ fontSize: 13, fontWeight: '700', color: '#111' }}>{t.cashCollected || 'Cash Collected'}</Text>
                                <Text style={{ fontSize: 13, fontWeight: '700', color: '#8B38CB' }}>{currency} {todayCashTotal.toFixed(2)}</Text>
                              </View>
                            </>
                          )}
                        </View>

                        {/* Grand Total Owed */}
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderTopWidth: 1.5, borderTopColor: '#8B38CB' }}>
                          <Text style={{ fontSize: 14, fontWeight: '700', color: '#8B38CB' }}>{t.totalToSubmit || 'Total to Submit'}</Text>
                          <Text style={{ fontSize: 14, fontWeight: '700', color: '#8B38CB' }}>{currency} {totalOwed.toFixed(2)}</Text>
                        </View>
                      </>
                    )}
                  </View>
                );
              })
              ) : (() => {
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

                const isCash = (pm: string) => pm?.toLowerCase().includes('bar') || pm?.toLowerCase().includes('cash');
                const formatDate = (d: Date) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()}`;

                const todayCashOrders = orders.filter((o: any) => {
                  if (!isCash(o.payment_method)) return false;
                  let d = new Date(o.delivered_at);
                  if (isNaN(d.getTime())) {
                    const parts = (o.delivered_at || '').match(/(\d+)\/(\d+)\/(\d+)/);
                    if (parts) d = new Date(`${parts[3]}-${parts[1].padStart(2,'0')}-${parts[2].padStart(2,'0')}`);
                  }
                  d.setHours(0,0,0,0);
                  return d.getTime() === today.getTime();
                });
                const todayCashTotal = todayCashOrders.reduce((sum: number, o: any) => sum + parseFloat(o.total || '0'), 0);
                const inProgress = courierClaims[name] || [];
                const inProgressCash = inProgress.filter((o: any) => isCash(o.payment_method));
                const inProgressCashTotal = inProgressCash.reduce((sum: number, o: any) => sum + parseFloat(o.total || '0'), 0);
                const totalOwed = todayCashTotal + inProgressCashTotal;
                const currency = orders[0]?.currency || inProgressCash[0]?.currency || 'CHF';

                return (
                  <View key={name} style={[styles.section, { marginBottom: 10 }]}>
                    <TouchableOpacity
                      style={[styles.row, { borderBottomWidth: isOpen ? 1 : 0 }]}
                      onPress={() => setExpandedCourier(isOpen ? null : name)}
                    >
                      <Ionicons name="bicycle-outline" size={16} color={isOpen ? '#8B38CB' : '#999'} />
                      <Text style={[styles.rowLabel, { fontWeight: '700', color: isOpen ? '#8B38CB' : '#111' }]}>{name}</Text>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ fontSize: 13, fontWeight: '700', color: totalOwed > 0 ? '#e74c3c' : '#2ecc71' }}>
                          {t.total || 'Total'}: {currency} {totalOwed.toFixed(2)}
                        </Text>
                      </View>
                      <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={16} color={isOpen ? '#8B38CB' : '#999'} />
                    </TouchableOpacity>

                    {isOpen && (
                      <>
                        {/* In Progress / Open Orders */}
                        {inProgress.length > 0 && (
                          <View style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' }}>
                            <Text style={{ fontSize: 11, fontWeight: '700', color: '#f39c12', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                              {t.openOrders || 'Open Orders'}
                            </Text>
                            {inProgressCash.map((o: any, oi: number) => (
                              <View key={o.order_id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: oi === inProgressCash.length - 1 ? 0 : 1, borderBottomColor: '#F5F5F5' }}>
                                <Text style={{ fontSize: 13, color: '#666' }}>#{o.order_id}</Text>
                                <Text style={{ fontSize: 13, color: '#f39c12', fontWeight: '600' }}>{currency} {parseFloat(o.total).toFixed(2)}</Text>
                              </View>
                            ))}
                            {inProgressCash.length === 0 && (
                              <Text style={{ fontSize: 13, color: '#999' }}>{t.noCashInProgress || 'No cash orders in progress'}</Text>
                            )}
                            {inProgressCash.length > 0 && (
                              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 6, marginTop: 4, borderTopWidth: 1, borderTopColor: '#f39c12' }}>
                                <Text style={{ fontSize: 12, fontWeight: '700', color: '#f39c12' }}>{t.unconfirmedCash || 'Unconfirmed Cash'}</Text>
                                <Text style={{ fontSize: 12, fontWeight: '700', color: '#f39c12' }}>{currency} {inProgressCashTotal.toFixed(2)}</Text>
                              </View>
                            )}
                          </View>
                        )}

                        {/* Today Delivered Cash */}
                        <View style={{ paddingVertical: 10 }}>
                          <Text style={{ fontSize: 11, fontWeight: '700', color: '#8B38CB', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
                            {t.today} — {t.delivered || 'Delivered'}
                          </Text>
                          {todayCashOrders.length === 0 ? (
                            <Text style={{ fontSize: 13, color: '#999' }}>{t.noDeliveriesToday || 'No cash deliveries today'}</Text>
                          ) : (
                            <>
                              {todayCashOrders.map((o: any, oi: number) => (
                                <View key={o.order_id} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4, borderBottomWidth: oi === todayCashOrders.length - 1 ? 0 : 1, borderBottomColor: '#F5F5F5' }}>
                                  <Text style={{ fontSize: 13, color: '#666' }}>#{o.order_id}</Text>
                                  <Text style={{ fontSize: 13, color: '#111', fontWeight: '600' }}>{currency} {parseFloat(o.total).toFixed(2)}</Text>
                                </View>
                              ))}
                              <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 6, marginTop: 4, borderTopWidth: 1.5, borderTopColor: '#111' }}>
                                <Text style={{ fontSize: 13, fontWeight: '700', color: '#111' }}>{t.cashCollected || 'Cash Collected'}</Text>
                                <Text style={{ fontSize: 13, fontWeight: '700', color: '#8B38CB' }}>{currency} {todayCashTotal.toFixed(2)}</Text>
                              </View>
                            </>
                          )}
                        </View>

                        {/* Grand Total Owed */}
                        <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 10, borderTopWidth: 1.5, borderTopColor: '#8B38CB' }}>
                          <Text style={{ fontSize: 14, fontWeight: '700', color: '#8B38CB' }}>{t.totalToSubmit || 'Total to Submit'}</Text>
                          <Text style={{ fontSize: 14, fontWeight: '700', color: '#8B38CB' }}>{currency} {totalOwed.toFixed(2)}</Text>
                        </View>
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
