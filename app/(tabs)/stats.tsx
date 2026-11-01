import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useFocusEffect } from 'expo-router';
import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  AppState,
  Easing,
  Image, Keyboard, LayoutAnimation, Platform,
  RefreshControl, SafeAreaView, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, TouchableWithoutFeedback, UIManager, View
} from 'react-native';
import { useLanguage } from '../../lib/useLanguage';
import { useIsFree } from '../../lib/edition';
import ProLocked from '../../components/ProLocked';

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
  older?: boolean;
}

interface CompactStatsCourier {
  name: string;
  currency: string;
  todayCashTotal: number;
  inProgressCashTotal: number;
  olderOpenCashTotal?: number;
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
  months?: { [key: string]: CompactStatsPeriod };
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

// Per-month totals ("YYYY-MM"). Older backends do not send them: then null.
function parseMonths(value: any): { [key: string]: CompactStatsPeriod } | null {
  if (!value || typeof value !== 'object') return null;
  const out: { [key: string]: CompactStatsPeriod } = {};
  Object.keys(value).forEach(key => {
    if (/^\d{4}-\d{2}$/.test(key) && isCompactStatsPeriod(value[key])) out[key] = value[key];
  });
  return out;
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

// ---------------------------------------------------------------------------
// Statistics screen UI
// ---------------------------------------------------------------------------

const BRAND = '#8B38CB';
const INK = '#17141F';
const MUTED = '#6C6678';
const LINE = '#ECE9F1';
const GREEN = '#1E7B45';
const RED = '#B3261E';
const AMBER = '#9A5B00';

if (Platform.OS === 'android' && (UIManager as any).setLayoutAnimationEnabledExperimental) {
  (UIManager as any).setLayoutAnimationEnabledExperimental(true);
}

function groupThousands(text: string) {
  return text.replace(/\B(?=(\d{3})+(?!\d))/g, "'");
}
function fmtInt(n: number) {
  return groupThousands(String(Math.round(n)));
}
function fmtMoney(n: number) {
  return groupThousands(n.toFixed(2));
}

interface CourierLine {
  id: string;
  amount: number;
  kind: 'open' | 'delivered';
  older: boolean;
}

interface CourierView {
  name: string;
  currency: string;
  owed: number;
  olderTotal: number;
  lines: CourierLine[];
}

function useReduceMotion() {
  const [reduce, setReduce] = useState(false);
  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then(v => { if (alive) setReduce(!!v); }).catch(() => {});
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => { alive = false; sub.remove(); };
  }, []);
  return reduce;
}

// Counts a number up or down to its new value (used for every figure).
function useTween(target: number, reduce: boolean, ms = 650) {
  const [value, setValue] = useState(target);
  const current = useRef(target);
  useEffect(() => {
    if (reduce) {
      current.current = target;
      setValue(target);
      return;
    }
    const from = current.current;
    if (from === target) return;
    const start = Date.now();
    let raf = 0;
    const step = () => {
      const t = Math.min(1, (Date.now() - start) / ms);
      const eased = 1 - Math.pow(1 - t, 3);
      const next = from + (target - from) * eased;
      current.current = next;
      setValue(next);
      if (t < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, reduce, ms]);
  return value;
}

function Rise({ delay = 0, reduce, children }: { delay?: number; reduce: boolean; children: ReactNode }) {
  const v = useRef(new Animated.Value(reduce ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) { v.setValue(1); return; }
    Animated.timing(v, { toValue: 1, duration: 480, delay, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [reduce, delay, v]);
  return (
    <Animated.View style={{ opacity: v, transform: [{ translateY: v.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }] }}>
      {children}
    </Animated.View>
  );
}

function Segmented({ labels, index, onChange, reduce, small }: { labels: string[]; index: number; onChange: (i: number) => void; reduce: boolean; small?: boolean }) {
  const [width, setWidth] = useState(0);
  const x = useRef(new Animated.Value(index)).current;
  useEffect(() => {
    if (reduce) { x.setValue(index); return; }
    Animated.timing(x, { toValue: index, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [index, reduce, x]);
  const thumbWidth = width > 0 ? (width - 6) / labels.length : 0;
  return (
    <View style={[styles.seg, small && styles.segSmall]} onLayout={e => setWidth(e.nativeEvent.layout.width)} accessibilityRole="tablist">
      {width > 0 && (
        <Animated.View
          style={[
            styles.segThumb,
            small && styles.segThumbSmall,
            {
              width: thumbWidth,
              transform: [{ translateX: x.interpolate({ inputRange: [0, labels.length - 1], outputRange: [0, thumbWidth * (labels.length - 1)] }) }],
            },
          ]}
        />
      )}
      {labels.map((label, i) => (
        <TouchableOpacity
          key={label}
          activeOpacity={0.7}
          style={styles.segItem}
          onPress={() => onChange(i)}
          accessibilityRole="tab"
          accessibilityState={{ selected: i === index }}
        >
          <Text style={[styles.segText, small && styles.segTextSmall, i === index && styles.segTextActive]}>{label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function SplitBar({ a, b, colorA, colorB }: { a: number; b: number; colorA: string; colorB: string }) {
  const hasData = a + b > 0;
  return (
    <View style={styles.splitBar}>
      {hasData ? (
        <>
          <View style={{ flex: Math.max(a, 0.0001), backgroundColor: colorA, borderTopLeftRadius: 4, borderBottomLeftRadius: 4, borderTopRightRadius: 1, borderBottomRightRadius: 1 }} />
          <View style={{ flex: Math.max(b, 0.0001), backgroundColor: colorB, borderTopRightRadius: 4, borderBottomRightRadius: 4, borderTopLeftRadius: 1, borderBottomLeftRadius: 1 }} />
        </>
      ) : (
        <View style={{ flex: 1, backgroundColor: LINE, borderRadius: 4 }} />
      )}
    </View>
  );
}

function Chevron({ open, reduce }: { open: boolean; reduce: boolean }) {
  const v = useRef(new Animated.Value(open ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) { v.setValue(open ? 1 : 0); return; }
    Animated.timing(v, { toValue: open ? 1 : 0, duration: 260, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [open, reduce, v]);
  return (
    <Animated.View style={{ transform: [{ rotate: v.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '180deg'] }) }] }}>
      <Ionicons name="chevron-down" size={16} color={MUTED} />
    </Animated.View>
  );
}

function LiveDot({ reduce }: { reduce: boolean }) {
  const v = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (reduce) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(v, { toValue: 0.35, duration: 1100, useNativeDriver: true }),
      Animated.timing(v, { toValue: 1, duration: 1100, useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [reduce, v]);
  return <Animated.View style={[styles.liveDot, { opacity: v }]} />;
}

const CHART_BAR_AREA = 104;
const CHART_HEIGHT = 232;
const CHART_GAP = 14;

interface MonthCol {
  letter: string;
  aria: string;
  total: number;
  has: boolean;
  selected: boolean;
  lit: boolean;
}

function MonthBar({ col, maxTotal, reduce, onPress }: { col: MonthCol; maxTotal: number; reduce: boolean; onPress: () => void }) {
  const target = col.has ? Math.max(4, Math.round((col.total / Math.max(1, maxTotal)) * CHART_BAR_AREA)) : 3;
  const h = useRef(new Animated.Value(target)).current;
  useEffect(() => {
    if (reduce) { h.setValue(target); return; }
    Animated.timing(h, { toValue: target, duration: 500, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [target, reduce, h]);
  const barColor = col.lit ? BRAND : col.has ? '#E6D7F5' : LINE;
  const letterColor = col.selected ? INK : col.has ? MUTED : '#B9B3C6';
  return (
    <TouchableOpacity
      activeOpacity={0.7}
      disabled={!col.has}
      style={styles.mCol}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={col.aria}
      accessibilityState={{ selected: col.selected, disabled: !col.has }}
    >
      <Text style={[styles.mValue, { opacity: col.selected ? 1 : 0 }]} numberOfLines={1}>
        {col.has ? `${(col.total / 1000).toFixed(1)}k` : ''}
      </Text>
      <View style={styles.mBarArea}>
        <Animated.View style={[styles.mBar, { height: h, backgroundColor: barColor }]} />
      </View>
      <Text style={[styles.mLetter, { color: letterColor, fontWeight: col.selected ? '700' : '500' }]}>{col.letter}</Text>
    </TouchableOpacity>
  );
}

// Slides open under the Month / Year switch. Takes exactly its own height, so nothing below jumps around.
function Drawer({ open, reduce, children }: { open: boolean; reduce: boolean; children: ReactNode }) {
  const v = useRef(new Animated.Value(open ? 1 : 0)).current;
  useEffect(() => {
    if (reduce) { v.setValue(open ? 1 : 0); return; }
    Animated.timing(v, { toValue: open ? 1 : 0, duration: 340, easing: Easing.out(Easing.cubic), useNativeDriver: false }).start();
  }, [open, reduce, v]);
  return (
    <Animated.View
      pointerEvents={open ? 'auto' : 'none'}
      style={{
        height: v.interpolate({ inputRange: [0, 1], outputRange: [0, CHART_HEIGHT] }),
        marginTop: v.interpolate({ inputRange: [0, 1], outputRange: [-CHART_GAP, 0] }),
        opacity: v,
        overflow: 'hidden',
      }}
    >
      {children}
    </Animated.View>
  );
}

function MonthChart({ title, hint, years, yearIndex, onYear, cols, maxTotal, onPick, reduce }: {
  title: string;
  hint: string;
  years: string[];
  yearIndex: number;
  onYear: (i: number) => void;
  cols: MonthCol[];
  maxTotal: number;
  onPick: (month: number) => void;
  reduce: boolean;
}) {
  return (
    <View style={styles.chartCard}>
      <View style={styles.chartTop}>
        <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
          <Text style={styles.chartTitle} numberOfLines={1}>{title}</Text>
          <Text style={styles.chartHint} numberOfLines={1}>{hint}</Text>
        </View>
        <View style={{ width: 124 }}>
          <Segmented labels={years} index={yearIndex} onChange={onYear} reduce={reduce} small />
        </View>
      </View>
      <View style={styles.chartCols}>
        {cols.map((col, i) => (
          <MonthBar key={i} col={col} maxTotal={maxTotal} reduce={reduce} onPress={() => onPick(i)} />
        ))}
      </View>
    </View>
  );
}

function CourierRow({ c, open, onToggle, reduce, t }: { c: CourierView; open: boolean; onToggle: () => void; reduce: boolean; t: any }) {
  const owes = c.owed > 0;
  const openCount = c.lines.filter(l => l.kind === 'open').length;
  const deliveredCount = c.lines.filter(l => l.kind === 'delivered').length;
  const sub = c.lines.length === 0
    ? t.statsNothingOpen
    : `${openCount} ${t.statsInProgress} · ${deliveredCount} ${t.statsDeliveredToday}`;
  return (
    <View style={styles.courierBlock}>
      <TouchableOpacity
        activeOpacity={0.6}
        style={styles.courierHead}
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
      >
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{c.name.charAt(0).toUpperCase()}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.courierName}>{c.name}</Text>
          <Text style={styles.courierSub}>{sub}</Text>
          {c.olderTotal > 0 && (
            <Text style={styles.courierWarn}>{c.currency} {fmtMoney(c.olderTotal)} {t.statsOlder}</Text>
          )}
        </View>
        <Text style={[styles.courierOwed, { color: owes ? RED : GREEN }]}>
          {owes ? `${c.currency} ${fmtMoney(c.owed)}` : t.statsSettled}
        </Text>
        <Chevron open={open} reduce={reduce} />
      </TouchableOpacity>
      {open && (
        <View style={styles.lines}>
          {c.lines.length === 0 ? (
            <Text style={styles.lineMuted}>{t.statsNoCash}</Text>
          ) : (
            c.lines.map(l => (
              <View key={`${l.kind}-${l.id}`} style={styles.lineRow}>
                <View style={[styles.lineDot, { backgroundColor: l.kind === 'delivered' ? GREEN : '#B7791F' }]} />
                <Text style={styles.lineId}>#{l.id}</Text>
                <Text style={[styles.lineMuted, l.older && { color: AMBER }]}>
                  {l.older ? t.statsOlder : l.kind === 'delivered' ? t.statsDeliveredToday : t.statsInProgress}
                </Text>
                <Text style={styles.lineAmount}>{c.currency} {fmtMoney(l.amount)}</Text>
              </View>
            ))
          )}
        </View>
      )}
    </View>
  );
}

// FoodUp Free: statistics are a Pro feature. The locked view makes no requests.
export default function StatsScreen() {
  const isFree = useIsFree();
  const { t } = useLanguage();
  if (isFree) {
    return <ProLocked title={t.proFeatureTitle} message={t.proStatsText} hint={t.proUpgradeHint} icon="bar-chart-outline" />;
  }
  return <ProStatsScreen />;
}

function ProStatsScreen() {
  const [orders, setOrders] = useState<Order[]>([]);
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
  const [monthsData, setMonthsData] = useState<{ [key: string]: CompactStatsPeriod } | null>(null);
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
    setMonthsData(null);
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

    setMonthsData(parseMonths(result.months));
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
  const [courierDelivered, setCourierDelivered] = useState<{ [key: string]: any[] }>({});
  const [courierClaims, setCourierClaims] = useState<{ [key: string]: any[] }>({});
  const [allOrders, setAllOrders] = useState<any[]>([]);
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

  const todayStats = statsPeriods?.today || getStats(orders, getStartOfDay());
  const weekStats = statsPeriods?.week || getStats(orders, getStartOfWeek());
  const monthStats = statsPeriods?.month || getStats(orders, getStartOfMonth());
  const yearStats = statsPeriods?.year || getStats(orders, getStartOfYear());
  const pastYearStats = statsPeriods?.previousYear || getStats(orders, getStartOfPastYear(), getEndOfPastYear());

  const reduce = useReduceMotion();
  const [period, setPeriod] = useState(0);
  const [openCourier, setOpenCourier] = useState<string | null>(null);

  // Month / year picker: bars for every month, one year at a time.
  const nowDate = new Date();
  const curYear = nowDate.getFullYear();
  const curMonth = nowDate.getMonth();
  const [selYear, setSelYear] = useState(curYear);
  const [selMonth, setSelMonth] = useState(curMonth);
  const monthNamesShort: string[] = String(t.statsMonthsShort).split(',');
  const monthNamesFull: string[] = String(t.statsMonthsFull).split(',');
  const monthKey = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, '0')}`;
  const monthAt = (y: number, m: number): StatsPeriod | null => {
    const e = monthsData ? monthsData[monthKey(y, m)] : null;
    return e ? withStatsCurrency(e, todayStats.currency) : null;
  };
  const isCurMonthSel = selYear === curYear && selMonth === curMonth;
  const selMonthStats: StatsPeriod = isCurMonthSel
    ? monthStats
    : monthAt(selYear, selMonth) || withStatsCurrency({ totalOrders: 0, cash: 0, online: 0, total: 0, deliveries: 0, pickups: 0 }, todayStats.currency);
  const selYearStats = selYear === curYear ? yearStats : pastYearStats;
  const periodStats: StatsPeriod[] = [todayStats, weekStats, selMonthStats, selYearStats];
  const current = periodStats[period];
  const segmentLabels = [t.today, t.statsWeek, t.statsMonth, t.statsYear];
  const chartOpen = period >= 2 && monthsData !== null;
  const chartYears = [curYear - 1, curYear];
  const pickYear = (i: number) => {
    const y = chartYears[i];
    setSelYear(y);
    setSelMonth(m => Math.min(m, y === curYear ? curMonth : 11));
  };
  const pickMonth = (m: number) => {
    setSelMonth(m);
    setPeriod(2);
  };
  const chartCols: MonthCol[] = monthNamesShort.map((label, i) => {
    const isFuture = selYear === curYear && i > curMonth;
    const isCurrent = selYear === curYear && i === curMonth;
    const entry = monthAt(selYear, i) || (isCurrent ? monthStats : null);
    const has = !isFuture && !!entry;
    const selected = period === 2 && i === selMonth;
    return {
      letter: label.charAt(0),
      aria: `${monthNamesFull[i]} ${selYear}`,
      total: entry ? entry.total : 0,
      has,
      selected,
      lit: selected || (period === 3 && has),
    };
  });
  let chartMax = 1;
  chartYears.forEach(y => {
    for (let m = 0; m < 12; m++) {
      const e = monthAt(y, m);
      if (e && e.total > chartMax) chartMax = e.total;
    }
  });

  const shownOrders = useTween(current.totalOrders, reduce);
  const shownDeliveries = useTween(current.deliveries, reduce);
  const shownPickups = useTween(current.pickups, reduce);
  const shownCash = useTween(current.cash, reduce);
  const shownOnline = useTween(current.online, reduce);
  const shownTotal = shownCash + shownOnline;
  const shownAvg = shownTotal / Math.max(1, shownOrders);
  const cashPct = shownTotal > 0 ? Math.round((shownCash / shownTotal) * 100) : 0;
  const onlinePct = shownTotal > 0 ? 100 - cashPct : 0;

  // Comparison with the year before. Only finished months are compared, so a half month is never set against a full one.
  let showDelta = false;
  let deltaPct = 0;
  let deltaLabel = '';
  if (period === 2 && monthsData && !isCurMonthSel) {
    const before = monthAt(selYear - 1, selMonth);
    if (before && before.total > 0) {
      showDelta = true;
      deltaPct = ((current.total - before.total) / before.total) * 100;
      deltaLabel = `${t.statsVs} ${monthNamesShort[selMonth]} ${selYear - 1}`;
    }
  } else if (period === 3 && selYear === curYear) {
    if (monthsData) {
      let nowSum = 0;
      let beforeSum = 0;
      for (let m = 0; m < curMonth; m++) {
        nowSum += monthAt(curYear, m)?.total || 0;
        beforeSum += monthAt(curYear - 1, m)?.total || 0;
      }
      if (curMonth > 0 && beforeSum > 0) {
        showDelta = true;
        deltaPct = ((nowSum - beforeSum) / beforeSum) * 100;
        const range = curMonth === 1 ? monthNamesShort[0] : `${monthNamesShort[0]}–${monthNamesShort[curMonth - 1]}`;
        deltaLabel = `${t.statsVs} ${curYear - 1} (${range})`;
      }
    } else if (pastYearStats.total > 0) {
      showDelta = true;
      deltaPct = ((yearStats.total - pastYearStats.total) / pastYearStats.total) * 100;
      deltaLabel = t.statsVsLastYear;
    }
  }
  const deltaText = `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(1)}%`;
  const soFar = ` · ${t.statsSoFar}`;
  let periodName = t.today;
  if (period === 1) periodName = t.thisWeek;
  if (period === 2) periodName = `${monthNamesShort[selMonth]} ${selYear}${isCurMonthSel ? soFar : ''}`;
  if (period === 3) periodName = `${selYear}${selYear === curYear && !showDelta ? soFar : ''}`;

  const lineAmount = (o: { total: number | string }) => {
    const n = parseFloat(String(o.total || '0'));
    return Number.isFinite(n) ? n : 0;
  };
  const isCashMethod = (pm: string) => pm?.toLowerCase().includes('bar') || pm?.toLowerCase().includes('cash');

  let couriersView: CourierView[] = [];
  if (compactCouriers !== null) {
    couriersView = compactCouriers.map(c => {
      const open: CourierLine[] = (c.openCashOrders || []).map(o => ({ id: String(o.order_id), amount: lineAmount(o), kind: 'open', older: !!o.older }));
      const delivered: CourierLine[] = (c.todayDeliveredCashOrders || []).map(o => ({ id: String(o.order_id), amount: lineAmount(o), kind: 'delivered', older: false }));
      return {
        name: c.name,
        currency: c.currency || 'CHF',
        owed: c.totalOwed,
        olderTotal: c.olderOpenCashTotal || 0,
        lines: [...open, ...delivered],
      };
    });
  } else {
    // Older backend without /stats: same figures as before, built from the raw lists.
    const names = Array.from(new Set([...Object.keys(courierDelivered), ...Object.keys(courierClaims)]));
    const todayStart = getStartOfDay().getTime();
    couriersView = names.map(name => {
      const delivered = (courierDelivered[name] || []).filter((o: any) => {
        if (!isCashMethod(o.payment_method)) return false;
        let d = new Date(o.delivered_at);
        if (isNaN(d.getTime())) {
          const parts = (o.delivered_at || '').match(/(\d+)\/(\d+)\/(\d+)/);
          if (parts) d = new Date(`${parts[3]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`);
        }
        d.setHours(0, 0, 0, 0);
        return d.getTime() === todayStart;
      });
      const open = (courierClaims[name] || []).filter((o: any) => isCashMethod(o.payment_method));
      const lines: CourierLine[] = [
        ...open.map((o: any) => ({ id: String(o.order_id), amount: lineAmount(o), kind: 'open' as const, older: false })),
        ...delivered.map((o: any) => ({ id: String(o.order_id), amount: lineAmount(o), kind: 'delivered' as const, older: false })),
      ];
      return {
        name,
        currency: delivered[0]?.currency || open[0]?.currency || 'CHF',
        owed: lines.reduce((sum, l) => sum + l.amount, 0),
        olderTotal: 0,
        lines,
      };
    }).sort((a, b) => b.owed - a.owed);
  }
  const owedTotal = couriersView.reduce((sum, c) => sum + c.owed, 0);
  const owedCurrency = couriersView[0]?.currency || current.currency || 'CHF';
  const toggleCourier = (name: string) => {
    if (!reduce) LayoutAnimation.configureNext(LayoutAnimation.create(260, LayoutAnimation.Types.easeInEaseOut, LayoutAnimation.Properties.opacity));
    setOpenCourier(prev => (prev === name ? null : name));
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
          <Rise reduce={reduce}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>{t.tabStatistics}</Text>
              <View style={styles.liveWrap}>
                <LiveDot reduce={reduce} />
                <Text style={styles.liveText}>{t.statsLive}</Text>
              </View>
            </View>
          </Rise>

          <Rise delay={50} reduce={reduce}>
            <Segmented labels={segmentLabels} index={period} onChange={setPeriod} reduce={reduce} />
          </Rise>

          {monthsData !== null && (
            <Drawer open={chartOpen} reduce={reduce}>
              <MonthChart
                title={t.statsByMonth}
                hint={period === 3 ? t.statsHintYear : t.statsHintMonth}
                years={chartYears.map(String)}
                yearIndex={selYear === curYear ? 1 : 0}
                onYear={pickYear}
                cols={chartCols}
                maxTotal={chartMax}
                onPick={pickMonth}
                reduce={reduce}
              />
            </Drawer>
          )}

          <Rise delay={100} reduce={reduce}>
            <View style={styles.card}>
              <View style={styles.cardTopRow}>
                <Text style={styles.eyebrow} numberOfLines={1}>{t.totalRevenue} · {periodName}</Text>
                {showDelta && (
                  <Text style={[styles.delta, { color: deltaPct >= 0 ? GREEN : RED }]} numberOfLines={1}>{deltaText} {deltaLabel}</Text>
                )}
              </View>
              <View style={styles.amountRow}>
                <Text style={styles.currency}>{current.currency}</Text>
                <Text style={styles.amount}>{fmtMoney(shownTotal)}</Text>
              </View>

              <View style={styles.hr} />

              <View style={styles.strip}>
                <View style={styles.stripCol}>
                  <Text style={styles.stripLabel}>{t.orders}</Text>
                  <Text style={styles.stripValue}>{fmtInt(shownOrders)}</Text>
                </View>
                <View style={[styles.stripCol, styles.stripColDivider]}>
                  <Text style={styles.stripLabel}>{t.statsAvgOrder}</Text>
                  <Text style={styles.stripValue}>{fmtMoney(shownAvg)}</Text>
                </View>
                <View style={[styles.stripCol, styles.stripColDivider]}>
                  <Text style={styles.stripLabel}>{t.deliveryLabel}</Text>
                  <Text style={styles.stripValue}>{fmtInt(shownDeliveries)}</Text>
                </View>
                <View style={[styles.stripCol, styles.stripColDivider]}>
                  <Text style={styles.stripLabel}>{t.pickupLabel}</Text>
                  <Text style={styles.stripValue}>{fmtInt(shownPickups)}</Text>
                </View>
              </View>
              {current.totalOrders === 0 && <Text style={styles.emptyNote}>{t.noOrders}</Text>}

              <View style={styles.hr} />

              <View style={styles.sectionTop}>
                <Text style={styles.sectionTitle}>{t.statsPayment}</Text>
                <Text style={styles.sectionMeta}>{t.cashPayment} {cashPct}% · {t.onlinePayment} {onlinePct}%</Text>
              </View>
              <SplitBar a={shownCash} b={shownOnline} colorA={INK} colorB={BRAND} />
              <View style={styles.legendRow}>
                <View style={styles.legendCol}>
                  <View style={[styles.swatch, { backgroundColor: INK }]} />
                  <Text style={styles.legendLabel}>{t.cashPayment}</Text>
                  <Text style={styles.legendValue}>{fmtMoney(shownCash)}</Text>
                </View>
                <View style={[styles.legendCol, styles.legendColDivider]}>
                  <View style={[styles.swatch, { backgroundColor: BRAND }]} />
                  <Text style={styles.legendLabel}>{t.onlinePayment}</Text>
                  <Text style={styles.legendValue}>{fmtMoney(shownOnline)}</Text>
                </View>
              </View>
            </View>
          </Rise>

          {couriersView.length > 0 && (
            <Rise delay={160} reduce={reduce}>
              <View style={styles.card}>
                <View style={styles.courierTop}>
                  <Text style={styles.sectionTitle}>{t.statsCourierCash}</Text>
                  <Text style={styles.sectionMeta}>{owedCurrency} {fmtMoney(owedTotal)} {t.statsToSubmit}</Text>
                </View>
                {couriersView.map(c => (
                  <CourierRow
                    key={c.name}
                    c={c}
                    open={openCourier === c.name}
                    onToggle={() => toggleCourier(c.name)}
                    reduce={reduce}
                    t={t}
                  />
                ))}
              </View>
            </Rise>
          )}
        </ScrollView>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F6F5F8' },
  header: { backgroundColor: '#fff', paddingTop: Platform.OS === 'android' ? 40 : 65, paddingBottom: 14, borderBottomWidth: 1, borderBottomColor: LINE, alignItems: 'center' },
  logo: { width: 100, height: 30 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 40, gap: 14 },
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2 },
  title: { fontSize: 18, fontWeight: '600', color: INK, letterSpacing: -0.2 },
  liveWrap: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: GREEN },
  liveText: { fontSize: 11, color: MUTED },
  seg: { flexDirection: 'row', height: 36, padding: 3, borderRadius: 10, backgroundColor: LINE, marginBottom: 14 },
  segThumb: { position: 'absolute', left: 3, top: 3, bottom: 3, borderRadius: 8, backgroundColor: '#fff', shadowColor: '#17141F', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.16, shadowRadius: 3, elevation: 2 },
  segItem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  segSmall: { height: 28, borderRadius: 9, marginBottom: 0 },
  segThumbSmall: { borderRadius: 7 },
  segTextSmall: { fontSize: 12 },
  chartCard: { height: CHART_HEIGHT, backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: LINE, padding: 20, shadowColor: '#17141F', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 2, elevation: 1 },
  chartTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
  chartTitle: { fontSize: 12, fontWeight: '600', color: INK },
  chartHint: { fontSize: 11, lineHeight: 14, height: 14, color: MUTED },
  chartCols: { flexDirection: 'row', marginTop: 14 },
  mCol: { flex: 1, minWidth: 0, height: 148, justifyContent: 'flex-end', alignItems: 'center', gap: 4 },
  mValue: { fontSize: 10, fontWeight: '600', height: 14, lineHeight: 14, color: INK, fontVariant: ['tabular-nums'] },
  mBarArea: { height: CHART_BAR_AREA, width: '100%', alignItems: 'center', justifyContent: 'flex-end' },
  mBar: { width: '62%', borderTopLeftRadius: 4, borderTopRightRadius: 4, borderBottomLeftRadius: 2, borderBottomRightRadius: 2 },
  mLetter: { fontSize: 11, height: 14, lineHeight: 14 },
  segText: { fontSize: 12.5, fontWeight: '500', color: MUTED },
  segTextActive: { fontWeight: '600', color: INK },
  card: { backgroundColor: '#fff', borderRadius: 14, borderWidth: 1, borderColor: LINE, padding: 20, shadowColor: '#17141F', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 2, elevation: 1 },
  cardTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eyebrow: { fontSize: 11, fontWeight: '500', letterSpacing: 0.6, textTransform: 'uppercase', color: MUTED, flexShrink: 1 },
  delta: { fontSize: 11, fontWeight: '600', fontVariant: ['tabular-nums'] },
  amountRow: { flexDirection: 'row', alignItems: 'baseline', gap: 6, marginTop: 8 },
  currency: { fontSize: 13, fontWeight: '600', color: MUTED },
  amount: { fontSize: 28, fontWeight: '700', letterSpacing: -0.6, color: INK, fontVariant: ['tabular-nums'] },
  hr: { height: 1, backgroundColor: LINE, marginVertical: 18 },
  strip: { flexDirection: 'row' },
  stripCol: { flex: 1, gap: 4 },
  stripColDivider: { paddingLeft: 12, borderLeftWidth: 1, borderLeftColor: LINE },
  stripLabel: { fontSize: 11, color: MUTED },
  stripValue: { fontSize: 15, fontWeight: '600', color: INK, fontVariant: ['tabular-nums'] },
  emptyNote: { fontSize: 12, color: MUTED, marginTop: 10 },
  sectionTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  sectionTitle: { fontSize: 12, fontWeight: '600', color: INK },
  sectionMeta: { fontSize: 11, color: MUTED, fontVariant: ['tabular-nums'] },
  splitBar: { flexDirection: 'row', gap: 2, height: 8 },
  legendRow: { flexDirection: 'row', marginTop: 12 },
  legendCol: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 },
  legendColDivider: { paddingLeft: 14, borderLeftWidth: 1, borderLeftColor: LINE },
  swatch: { width: 8, height: 8, borderRadius: 2 },
  legendLabel: { fontSize: 12, color: MUTED, flexShrink: 1 },
  legendValue: { fontSize: 12, fontWeight: '600', color: INK, marginLeft: 'auto', fontVariant: ['tabular-nums'] },
  courierTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 12 },
  courierBlock: { borderTopWidth: 1, borderTopColor: LINE },
  courierHead: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F3EAFB', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 12, fontWeight: '700', color: BRAND },
  courierName: { fontSize: 13, fontWeight: '600', color: INK },
  courierSub: { fontSize: 11, color: MUTED, marginTop: 2 },
  courierWarn: { fontSize: 11, color: AMBER, marginTop: 2 },
  courierOwed: { fontSize: 13, fontWeight: '600', fontVariant: ['tabular-nums'] },
  lines: { paddingBottom: 12, paddingLeft: 44, gap: 8 },
  lineRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  lineDot: { width: 6, height: 6, borderRadius: 3 },
  lineId: { fontSize: 12, fontWeight: '500', color: INK, fontVariant: ['tabular-nums'] },
  lineMuted: { fontSize: 12, color: MUTED },
  lineAmount: { fontSize: 12, fontWeight: '600', color: INK, marginLeft: 'auto', fontVariant: ['tabular-nums'] },
});
