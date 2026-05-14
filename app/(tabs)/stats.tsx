import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  Image, Platform,
  SafeAreaView, ScrollView,
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
  const [expanded, setExpanded] = useState<string[]>([]);
  const [courierStats, setCourierStats] = useState<{ [key: string]: { today: number; week: number; total: number } }>({});
  const { t } = useLanguage();

useFocusEffect(
    useCallback(() => {
      AsyncStorage.getItem('restaurant_code').then(code => {
        if (code) {
          fetch(`https://foodup-order-alerts-backend.onrender.com/orders/${code}`)
            .then(r => r.json())
            .then(result => {
              if (result.success) {
                const validOrders = result.orders
                  .filter((o: any) => o.date_created)
                  .map((o: any) => ({
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
            })
            .catch(() => {});
        }
      });
      AsyncStorage.getItem('restaurant_code').then(code => {
        if (code) {
          fetch(`${BACKEND_URL}/courier-stats/${code}`)
            .then(r => r.json())
            .then(result => {
              if (result.success) setCourierStats(result.stats);
            })
            .catch(() => {});
        }
      });
    }, [])
  );

  const toggleExpand = (key: string) => {
    setExpanded(prev =>
      prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key]
    );
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
      <View style={styles.row}>
        <Ionicons name="bicycle-outline" size={16} color="#999" />
        <Text style={styles.rowLabel}>{t.deliveryLabel}</Text>
        <Text style={styles.rowValue}>{stats.deliveries}</Text>
      </View>
      <View style={styles.row}>
        <Ionicons name="bag-outline" size={16} color="#999" />
        <Text style={styles.rowLabel}>{t.pickupLabel}</Text>
        <Text style={styles.rowValue}>{stats.pickups}</Text>
      </View>
      <View style={styles.divider} />
      <View style={styles.row}>
        <Ionicons name="cash-outline" size={16} color="#999" />
        <Text style={styles.rowLabel}>{t.cash}</Text>
        <Text style={styles.rowValue}>{stats.currency} {stats.cash.toFixed(2)}</Text>
      </View>
      <View style={styles.row}>
        <Ionicons name="card-outline" size={16} color="#999" />
        <Text style={styles.rowLabel}>{t.online}</Text>
        <Text style={styles.rowValue}>{stats.currency} {stats.online.toFixed(2)}</Text>
      </View>
      <View style={[styles.row, { borderBottomWidth: 0 }]}>
        <Ionicons name="trending-up-outline" size={16} color="#999" />
        <Text style={[styles.rowLabel, { fontWeight: '700', color: '#111' }]}>{t.totalRevenue}</Text>
        <Text style={[styles.rowValue, { fontWeight: '700', color: '#111' }]}>{stats.currency} {stats.total.toFixed(2)}</Text>
      </View>
    </>
  );

  const CollapsibleCard = ({ title, statsKey, stats }: { title: string; statsKey: string; stats: any }) => {
    const isOpen = expanded.includes(statsKey);
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
        <ScrollView contentContainerStyle={styles.scrollContent}>

          <Text style={styles.groupLabel}>{t.today}</Text>
          <View style={styles.section}>
            <StatRows stats={todayStats} />
          </View>

            <CollapsibleCard title={t.thisWeek} statsKey="week" stats={weekStats} />
            <CollapsibleCard title={t.thisMonth} statsKey="month" stats={monthStats} />
            <CollapsibleCard title={t.thisYear} statsKey="year" stats={yearStats} />
            {Object.keys(courierStats).length > 0 && (
            <>
              <Text style={styles.groupLabel}>{t.courierPerformance}</Text>
              <View style={styles.section}>
                {Object.entries(courierStats)
            .sort(([a], [b]) => {
              if (a === 'Owner') return -1;
              if (b === 'Owner') return 1;
              return a.localeCompare(b);
            })
            .map(([name, stats], i, arr) => (
                  <View key={name} style={[styles.row, i === arr.length - 1 && { borderBottomWidth: 0 }]}>
                    <Ionicons name="bicycle-outline" size={16} color="#999" />
                    <Text style={[styles.rowLabel, { flex: 1, fontWeight: '600', color: '#111' }]}>{name}</Text>
                    <View style={{ alignItems: 'flex-end', gap: 2 }}>
                      <Text style={{ fontSize: 12, color: '#999' }}>{t.today}: <Text style={{ color: '#111', fontWeight: '600' }}>{stats.today}</Text></Text>
                      <Text style={{ fontSize: 12, color: '#999' }}>{t.thisWeek}: <Text style={{ color: '#111', fontWeight: '600' }}>{stats.week}</Text></Text>
                      <Text style={{ fontSize: 12, color: '#999' }}>{t.total}: <Text style={{ color: '#111', fontWeight: '600' }}>{stats.total}</Text></Text>
                    </View>
                  </View>
                ))}
              </View>
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
  divider: { height: 1, backgroundColor: '#F0F0F0', marginVertical: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' },
  rowLabel: { fontSize: 14, color: '#666', flex: 1 },
  rowValue: { fontSize: 14, color: '#111', fontWeight: '500' },
  chevron: { fontSize: 12, color: '#999' },
});