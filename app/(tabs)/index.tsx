import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import * as Notifications from 'expo-notifications';
import { useFocusEffect, useRouter } from 'expo-router';
import * as Updates from 'expo-updates';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated, AppState, BackHandler,
  FlatList,
  Image,
  Linking,
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
import AcceptRejectModal from '../../components/AcceptRejectModal';
import CustomAlert from '../../components/CustomAlert';
import OrderCountdown from '../../components/OrderCountdown';
import ScheduledCountdown from '../../components/ScheduledCountdown';
import { formatDate, formatISODate, wcDateToMs } from '../../lib/dateUtils';
import { formatAddress, formatPhone } from '../../lib/formatters';
import { getOrderPrimaryLabel, getQrOrderContextLabel, getTableLabel, isDineInOrder } from '../../lib/orderDisplay';
import { orderRingtoneKey, releaseOrderRingtoneSuppression, resolveOrderRingtone, suppressOrderRingtone } from '../../lib/orderRingtone';
import { groupOrdersByDate, isOlderThanToday, isPickupMethod, isScheduledOrder, isTodayBeforeThreeAM } from '../../lib/orderUtils';
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
  fulfillment_type?: string;
  order_type?: string;
  qr_order_number?: number;
  qr_service_day?: string;
  table_id?: string | number;
  table_number?: string;
  table_name?: string;
  table_session_id?: string;
  table_round_id?: string;
  table_integration?: string;
  source?: string;
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

function isUnpaidOrder(order: any): boolean {
  const method = String(order?.payment_method || '').trim().toLowerCase();
  const normalCashPayment = method.includes('bar') || method.includes('cash');

  if (!isDineInOrder(order)) {
    return normalCashPayment;
  }

  return (
    normalCashPayment ||
    method === 'fuo_table_counter' ||
    method === 'fuo_table_waiter' ||
    method.includes('cashier') ||
    method.includes('counter') ||
    method.includes('kasse') ||
    method.includes('waiter') ||
    method.includes('service') ||
    method.includes('pay later')
  );
}

function getDeliveryStatusColor(claim: any, orderStatus?: string) {
  if (orderStatus === 'refunded') return '#e67e22';
  if (orderStatus === 'cancelled') return '#e74c3c';
  if (!claim && orderStatus === 'kitchen') return '#1976D2';
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
  if (item.status === 'refunded') return t.refunded;
  if (item.status === 'cancelled') return t.cancelled;
  if (!claim && item.status === 'kitchen') return t.kitchen || 'Kitchen';
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

function formatAcceptedTimeCompact(value: string) {
  const text = String(value || '').trim();

  if (!text) return '';
  if (text.includes('—')) return text;

  const match = text.match(/^(\d+)\s*(minutes|minuten|min|m)?$/i);
  if (!match) return text;

  return `${match[1]}m`;
}

function parseScheduledAcceptedTime(at: string): number | null {
  const pieces = String(at || '').split('—');
  if (pieces.length < 2) return null;

  const timeMatch = pieces[0].trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!timeMatch) return null;

  const dateText = pieces[1].trim();

  const dmy = dateText.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const iso = dateText.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);

  let year: number;
  let month: number;
  let day: number;

  if (dmy) {
    day = Number(dmy[1]);
    month = Number(dmy[2]);
    year = Number(dmy[3]);
  } else if (iso) {
    year = Number(iso[1]);
    month = Number(iso[2]);
    day = Number(iso[3]);
  } else {
    return null;
  }

  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);

  if (
    month < 1 || month > 12 ||
    day < 1 || day > 31 ||
    hour < 0 || hour > 23 ||
    minute < 0 || minute > 59
  ) {
    return null;
  }

  const date = new Date(year, month - 1, day, hour, minute, 0, 0);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day ||
    date.getHours() !== hour ||
    date.getMinutes() !== minute
  ) {
    return null;
  }

  return date.getTime();
}
const BACKEND_URL = 'https://foodup-order-alerts-backend.onrender.com';
const STORAGE_KEY = 'foodup_orders';

async function postTableWordPressStatus(
  url: string,
  body: Record<string, unknown>
): Promise<void> {
  let lastError: unknown = new Error('Table status synchronization failed');

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

      const result: any = await response.json().catch(() => ({}));

      if (!response.ok || result?.success !== true) {
        throw new Error(
          `Table status synchronization failed with HTTP ${response.status}`
        );
      }

      return;
    } catch (error) {
      lastError = error;
      if (attempt < 3) {
        await new Promise(resolve => setTimeout(resolve, attempt * 500));
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  throw (lastError instanceof Error
    ? lastError
    : new Error('Table status synchronization failed'));
}


export default function OrdersScreen() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null); // kept for compatibility
  const [refreshing, setRefreshing] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [claims, setClaims] = useState<{ [key: string]: any }>({});
const [acceptedTimes, setAcceptedTimes] = useState<{ [key: string]: any }>({});
const [filter, setFilter] = useState<string>('today');
const [search, setSearch] = useState<string>('');
const [acceptRejectOrder, setAcceptRejectOrder] = useState<Order | null>(null);
const [showAcceptReject, setShowAcceptReject] = useState(false);
const [pickupReadyOrders, setPickupReadyOrders] = useState<{[key: string]: boolean}>({});
const [storeIsOpen, setStoreIsOpen] = useState<boolean | null>(null);
const [alertConfig, setAlertConfig] = useState<{ visible: boolean; title: string; message: string; buttons: any[]; icon?: string; iconColor?: string }>({ visible: false, title: '', message: '', buttons: [] });
const [canPrint, setCanPrint] = useState(false);
const [canUseKitchen, setCanUseKitchen] = useState(false);
const [autoPrintOrders, setAutoPrintOrders] = useState<{[key: string]: any}>({});
const [pendingDecisionOrders, setPendingDecisionOrders] = useState<number[]>([]);
const [tableOrderingEnabled, setTableOrderingEnabled] = useState(false);
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

  const fetchTableOrderingEnabled = async () => {
    try {
      const code = String(await AsyncStorage.getItem('restaurant_code') || '').toLowerCase().trim();
      if (!code) {
        setTableOrderingEnabled(false);
        return;
      }

      const profile = await fetch(`${BACKEND_URL}/restaurant-profile/${code}`)
        .then(r => r.json())
        .catch(() => ({}));

      const website = String(profile?.profile?.website || '').trim();
      if (!website) {
        setTableOrderingEnabled(false);
        return;
      }

      const baseUrl = website.startsWith('http') ? website.replace(/\/$/, '') : `https://${website.replace(/\/$/, '')}`;
      const response = await fetch(`${baseUrl}/wp-json/foodup/v1/table-ordering-status`);
      const result = await response.json().catch(() => ({}));

      setTableOrderingEnabled(
        response.ok &&
        result?.enabled === true &&
        String(result?.integration || '') === 'foodup_orders'
      );
    } catch (e) {
      // Capability lookup is optional. Hide the Table filter on a temporary failure.
      setTableOrderingEnabled(false);
    }
  };

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
      // One synchronization when the Orders tab gains focus.
      fetchOrdersFromBackend();
      fetchClaims();
      fetchStoreStatus();
      fetchTableOrderingEnabled();
      loadAutoPrintOrders();
      loadPendingDecision();
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
    if (!tableOrderingEnabled && filter === 'table') {
      setFilter('today');
    }
  }, [tableOrderingEnabled, filter]);

  useEffect(() => {
    AsyncStorage.getItem('user_role').then(r => {
      setRole(r);
    });
    checkPrintPermission();

    // These two timers only inspect local AsyncStorage. They make no Render calls
    // and keep notification-created local state visible while this tab is open.
    let lastAutoRefresh = '';
    const autoRefreshInterval = setInterval(async () => {
      const flag = await AsyncStorage.getItem('auto_accepted_refresh');
      if (flag && flag !== lastAutoRefresh) {
        lastAutoRefresh = flag;
        loadAutoPrintOrders();
      }
    }, 2000);

    let lastPendingRefresh = '';
    const pendingRefreshInterval = setInterval(async () => {
      const flag = await AsyncStorage.getItem('pending_decision_refresh');
      if (flag && flag !== lastPendingRefresh) {
        lastPendingRefresh = flag;
        loadPendingDecision();
        void refreshOrdersData();
      }
    }, 2000);

    // RootLayout performs the guaranteed live reconciliation. When it discovers
    // an order that arrived without a push, refresh this screen from the backend.
    let lastOrdersLiveRefresh = '';
    const ordersLiveRefreshInterval = setInterval(async () => {
      const flag = await AsyncStorage.getItem('orders_live_refresh');
      if (flag && flag !== lastOrdersLiveRefresh) {
        lastOrdersLiveRefresh = flag;
        void fetchOrdersFromBackend();
      }
    }, 2000);

    return () => {
      clearInterval(autoRefreshInterval);
      clearInterval(pendingRefreshInterval);
      clearInterval(ordersLiveRefreshInterval);
    };
  }, []);

  const checkPrintPermission = async (): Promise<boolean> => {
    if (Platform.OS !== 'android') return false;

    try {
      const code = await AsyncStorage.getItem('restaurant_code') || '';
      const deviceId = Application.getAndroidId() || '';

      const previewKitchenTester =
        Updates.channel === 'preview' &&
        code.toLowerCase() === 'eatime';

      // Kitchen is allowed for Eatime preview testing independently
      // from printer-device permission.
      if (previewKitchenTester) {
        setCanUseKitchen(true);
      }

      const res = await fetch(`${BACKEND_URL}/printer-device/${code}`);
      const result = await res.json();

      const allowed =
        result.success &&
        result.device_id &&
        result.device_id === deviceId;

      // Printing remains restricted to the registered printer.
      setCanPrint(allowed);

      // Kitchen works on the real printer OR Eatime preview.
      setCanUseKitchen(Boolean(allowed || previewKitchenTester));

      await AsyncStorage.setItem(
        'can_print',
        allowed ? 'true' : 'false'
      );

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
  // Orders foreground synchronization.
  // Runs once when the app returns from background/inactive state.
  // This is event-driven and does not restore backend polling.
  useEffect(() => {
    let previousState = AppState.currentState;

    const subscription = AppState.addEventListener('change', nextState => {
      const returnedToForeground =
        nextState === 'active' &&
        (previousState === 'background' || previousState === 'inactive');

      previousState = nextState;

      if (!returnedToForeground) return;

      void fetchOrdersFromBackend();
      void fetchClaims();
    });

    return () => subscription.remove();
  }, []);

  const fetchClaims = async () => {
    try {
      const code = await AsyncStorage.getItem('restaurant_code') || '';
      if (!code) return;
      const response = await fetch(`${BACKEND_URL}/claims/${code}`);
      const result = await response.json();
      if (result.success) {
        if (orders.length === 0) {
          setClaims(result.claims);
          return;
        }
        const currentOrderIds = new Set(orders.map(o => String(o.order_id)));
        const filteredClaims: { [key: string]: any } = {};
        Object.keys(result.claims).forEach(orderId => {
          if (currentOrderIds.has(orderId)) {
            filteredClaims[orderId] = result.claims[orderId];
          }
        });
        setClaims(filteredClaims);
      }
    } catch (e) {}
  };

  const fetchAcceptedTimes = async (orderList: Order[]) => {
    try {
      const code = await AsyncStorage.getItem('restaurant_code') || '';
      if (!code) return;

      const orderIds = orderList
        .filter(o => o.status !== 'cancelled')
        .map(o => String(o.order_id));
      if (orderIds.length === 0) return;

      const res = await fetch(`${BACKEND_URL}/accepted-times/${code}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ order_ids: orderIds }),
      });
      const result = await res.json();
      if (result.success && result.times) {
        setAcceptedTimes(prev => ({ ...prev, ...result.times }));
      }
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
          date: o.date_created ? formatDate(o.date_created) : formatDate(new Date().toISOString()),
          timestamp: o.date_created ? wcDateToMs(o.date_created) : Date.now(),
          shipping_method: o.shipping?.method || '',
          shipping_address: o.shipping?.address || '',
          restaurant_code: o.restaurant_code || '',
          orderable_order_date: o.orderable_order_date || '',
          orderable_order_time: o.orderable_order_time || '',
          date_created: o.date_created || '',
          fulfillment_type: o.fulfillment_type || o.order_type || '',
          order_type: o.order_type || o.fulfillment_type || '',
          qr_order_number: Number(o.qr_order_number || 0) || undefined,
          qr_service_day: o.qr_service_day || '',
          table_id: o.table_id || '',
          table_number: o.table_number || '',
          table_name: o.table_name || '',
          table_session_id: o.table_session_id || '',
          table_round_id: o.table_round_id || '',
          table_integration: o.table_integration || '',
          source: o.source || '',
        }));
        setOrders(prev => {
          const merged = [...prev];
          let hasChanges = false;
          backendOrders.forEach(bo => {
            const exists = merged.findIndex(o => o.order_id === bo.order_id);
            if (exists === -1) {
              merged.push(bo);
              hasChanges = true;
            } else {
              const current = merged[exists];
              const metadataChanged =
                bo.status !== current.status ||
                bo.fulfillment_type !== current.fulfillment_type ||
                bo.qr_order_number !== current.qr_order_number ||
                bo.qr_service_day !== current.qr_service_day ||
                bo.table_number !== current.table_number ||
                bo.table_name !== current.table_name ||
                bo.table_session_id !== current.table_session_id ||
                bo.table_round_id !== current.table_round_id;
              if (metadataChanged) {
                merged[exists] = { ...current, ...bo };
                hasChanges = true;
              }
            }
          });
          if (!hasChanges) return prev;
          merged.sort((a, b) => b.order_id - a.order_id);
          AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
          return merged;
        });
        fetchAcceptedTimes(backendOrders.filter(o => o.status !== 'cancelled'));
      }
    } catch (e) {}
  };

  

  useEffect(() => {
    AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(orders));
  }, [orders]);

  useEffect(() => {
      const subscription = Notifications.addNotificationReceivedListener(notification => {
        const data = notification.request.content.data as any;

        if (data.event_type === 'auto_accepted') {
          const printData = {
            accepted_time: data.accepted_time || '',
            order_id: data.order_id,
            customer_name: data.customer_name || '',
            customer_email: data.customer_email || '',
            customer_phone: data.customer_phone || '',
            total: data.total || '',
            currency: data.currency || 'CHF',
            payment_method: data.payment_method || '',
            note: data.note || '',
            shipping_method: data.shipping_method || '',
            shipping_address: data.shipping_address || '',
            orderable_order_time: data.orderable_order_time || '',
            orderable_order_date: data.orderable_order_date || '',
            date_created: data.date_created || '',
            fulfillment_type: data.fulfillment_type || data.order_type || '',
            order_type: data.order_type || data.fulfillment_type || '',
            qr_order_number: Number(data.qr_order_number || 0) || undefined,
            qr_service_day: data.qr_service_day || '',
            table_id: data.table_id || '',
            table_number: data.table_number || '',
            table_name: data.table_name || '',
            table_session_id: data.table_session_id || '',
            table_round_id: data.table_round_id || '',
            table_integration: data.table_integration || '',
            source: data.source || '',
            items: data.items || '[]',
          };
          AsyncStorage.setItem(`auto_print_${data.order_id}`, JSON.stringify(printData)).catch(() => {});
          setAutoPrintOrders(prev => ({ ...prev, [String(data.order_id)]: printData }));

          // Backend auto-accept may still be writing the accepted-time state
          // when this notification arrives. Refresh once after 7 seconds.
          setTimeout(() => {
            void refreshOrdersData();
          }, 7000);

          return;
        }

        if (data.event_type === 'order_accepted_update') {
          const orderId = String(data.order_id || '');

          if (orderId) {
            setAcceptedTimes(prev => ({
              ...prev,
              [orderId]: {
                accepted_time: String(data.accepted_time || ''),
                accepted_at: String(data.accepted_at || new Date().toISOString()),
                status: 'accepted',
              },
            }));
          }

          return;
        }

        if (data.event_type === 'courier_status_update') {
          // Courier changed in_bag / delivering / delivered.
          // Refresh claims exactly once; no polling.
          void fetchClaims();
          return;
        }

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
        date: data.date_created ? formatDate(data.date_created) : formatDate(new Date().toISOString()),
        timestamp: data.sent_at ? new Date(data.sent_at).getTime() : (data.date_created ? wcDateToMs(data.date_created) : Date.now()),
        shipping_method: data.shipping_method || '',
        shipping_address: data.shipping_address || '',
        restaurant_code: data.restaurant_code || '',
        orderable_order_time: data.orderable_order_time || '',
        orderable_order_date: data.orderable_order_date || '',
        date_created: data.date_created || '',
        fulfillment_type: data.fulfillment_type || data.order_type || '',
        order_type: data.order_type || data.fulfillment_type || '',
        qr_order_number: Number(data.qr_order_number || 0) || undefined,
        qr_service_day: data.qr_service_day || '',
        table_id: data.table_id || '',
        table_number: data.table_number || '',
        table_name: data.table_name || '',
        table_session_id: data.table_session_id || '',
        table_round_id: data.table_round_id || '',
        table_integration: data.table_integration || '',
        source: data.source || '',
        };

        if (data.event_type === 'status_update') {
          setPendingDecisionOrders(prev => prev.filter(id => id !== newOrder.order_id));
          setOrders(prev => {
            const exists = prev.findIndex(o => o.order_id === newOrder.order_id);
            if (exists >= 0 && data.status) {
              const updated = [...prev];
              updated[exists] = { ...updated[exists], ...newOrder, status: data.status };
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

  const refreshOrdersData = async () => {
    await Promise.all([
      fetchOrdersFromBackend(),
      fetchClaims(),
      fetchStoreStatus(),
    ]);
    await Promise.all([
      loadAutoPrintOrders(),
      loadPendingDecision(),
    ]);
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await refreshOrdersData();
    setRefreshing(false);
  };

  const moveOrderToKitchen = async (order: Order) => {
    try {
      if (!canUseKitchen) return;

      const code = await AsyncStorage.getItem('restaurant_code') || '';
      const tableOrder = isDineInOrder(order);

      let baseUrl = '';

      // For table orders the WordPress lifecycle is the customer's live status
      // source of truth. Confirm it first so the app never advances locally
      // while the guest page is still stuck on "Accepted".
      if (tableOrder) {
        const restaurantProfile = await fetch(`${BACKEND_URL}/restaurant-profile/${code}`)
          .then(r => r.json())
          .catch(() => ({}));
        const website = restaurantProfile?.profile?.website;

        if (!website) {
          throw new Error('Restaurant website is not configured');
        }

        baseUrl = website.startsWith('http') ? website : `https://${website}`;

        await postTableWordPressStatus(
          `${baseUrl}/wp-json/foodup/v1/order-kitchen`,
          {
            secret: 'foodup2026',
            order_id: order.order_id,
          }
        );
      }

      const backendResponse = await fetch(`${BACKEND_URL}/status-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurant_code: code,
          order_id: order.order_id,
          status: 'kitchen',
          customer_name: order.customer_name || '',
          customer_email: order.customer_email || '',
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
          fulfillment_type: order.fulfillment_type || order.order_type || '',
          order_type: order.order_type || order.fulfillment_type || '',
          qr_order_number: order.qr_order_number || '',
          qr_service_day: order.qr_service_day || '',
          table_id: order.table_id || '',
          table_number: order.table_number || '',
          table_name: order.table_name || '',
          table_session_id: order.table_session_id || '',
          table_round_id: order.table_round_id || '',
          table_integration: order.table_integration || '',
          source: order.source || '',
          sound: false,
        }),
      });

      if (!backendResponse.ok) {
        throw new Error(`FoodUp status update failed with HTTP ${backendResponse.status}`);
      }

      // Preserve the existing normal-order WordPress callback behavior.
      if (!tableOrder) {
        const restaurantProfile = await fetch(`${BACKEND_URL}/restaurant-profile/${code}`)
          .then(r => r.json())
          .catch(() => ({}));
        const website = restaurantProfile?.profile?.website;

        if (website) {
          const normalBaseUrl = website.startsWith('http') ? website : `https://${website}`;
          fetch(`${normalBaseUrl}/wp-json/foodup/v1/order-kitchen`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secret: 'foodup2026', order_id: order.order_id }),
          }).catch(() => {});
        }
      }

      const updatedOrder = { ...order, status: 'kitchen' };

      setOrders(prev => prev.map(o =>
        o.order_id === order.order_id ? updatedOrder : o
      ));

      setSelectedOrder(prev =>
        prev && prev.order_id === order.order_id ? updatedOrder : prev
      );
    } catch (e) {
      console.log(
        '[table-status] kitchen sync failed:',
        e instanceof Error ? e.message : String(e)
      );

      if (isDineInOrder(order)) {
        Alert.alert(
          t.error || 'Error',
          t.tableStatusSyncFailed || 'Table status could not be synchronized. Please try again.'
        );
      }
    }
  };


  const markTableOrderReady = async (order: Order) => {
    if (!isDineInOrder(order)) return;

    try {
      const code = await AsyncStorage.getItem('restaurant_code') || '';

      const restaurantProfile = await fetch(`${BACKEND_URL}/restaurant-profile/${code}`)
        .then(r => r.json())
        .catch(() => ({}));
      const website = restaurantProfile?.profile?.website;

      if (!website) {
        throw new Error('Restaurant website is not configured');
      }

      const baseUrl = website.startsWith('http') ? website : `https://${website}`;

      // Keep the guest page and owner app in the same sequence. WordPress is
      // confirmed first because it owns the live customer-facing table status.
      await postTableWordPressStatus(
        `${baseUrl}/wp-json/foodup/v1/order-ready-pickup`,
        {
          secret: 'foodup2026',
          order_id: order.order_id,
          send_email: false,
        }
      );

      const backendResponse = await fetch(`${BACKEND_URL}/status-update`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          restaurant_code: code,
          order_id: order.order_id,
          status: 'ready_for_pickup',
          customer_name: order.customer_name || '',
          customer_email: order.customer_email || '',
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
          fulfillment_type: order.fulfillment_type || order.order_type || '',
          order_type: order.order_type || order.fulfillment_type || '',
          qr_order_number: order.qr_order_number || '',
          qr_service_day: order.qr_service_day || '',
          table_id: order.table_id || '',
          table_number: order.table_number || '',
          table_name: order.table_name || '',
          table_session_id: order.table_session_id || '',
          table_round_id: order.table_round_id || '',
          table_integration: order.table_integration || '',
          source: order.source || '',
          sound: false,
        }),
      });

      if (!backendResponse.ok) {
        throw new Error(`FoodUp status update failed with HTTP ${backendResponse.status}`);
      }

      const updatedOrder = { ...order, status: 'ready_for_pickup' };
      setOrders(prev => prev.map(o => o.order_id === order.order_id ? updatedOrder : o));
      setSelectedOrder(prev => prev && prev.order_id === order.order_id ? updatedOrder : prev);
    } catch (e) {
      console.log(
        '[table-status] ready sync failed:',
        e instanceof Error ? e.message : String(e)
      );

      Alert.alert(
        t.error || 'Error',
        t.tableStatusSyncFailed || 'Table status could not be synchronized. Please try again.'
      );
    }
  };


  const closeTableSession = async (order: Order) => {
    if (!isDineInOrder(order) || !order.table_session_id) return;

    try {
      const code = await AsyncStorage.getItem('restaurant_code') || '';
      const restaurantProfile = await fetch(`${BACKEND_URL}/restaurant-profile/${code}`)
        .then(r => r.json())
        .catch(() => ({}));
      const website = restaurantProfile?.profile?.website;

      if (!website) throw new Error('Restaurant website is not configured');

      const baseUrl = website.startsWith('http') ? website : `https://${website}`;

      // WordPress owns the table session. Close it first so the QR/customer side
      // is authoritative before the owner app changes locally.
      await postTableWordPressStatus(
        `${baseUrl}/wp-json/foodup/v1/table-close`,
        {
          secret: 'foodup2026',
          order_id: order.order_id,
        }
      );

      const sameSessionOrders = orders.filter(item =>
        isDineInOrder(item) &&
        String(item.table_session_id || '') === String(order.table_session_id || '')
      );
      const targets = sameSessionOrders.length > 0 ? sameSessionOrders : [order];

      for (const target of targets) {
        const response = await fetch(`${BACKEND_URL}/status-update`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            restaurant_code: code,
            order_id: target.order_id,
            status: 'table_completed',
            customer_name: target.customer_name || '',
            customer_email: target.customer_email || '',
            customer_phone: target.customer_phone || '',
            total: target.total || '',
            currency: target.currency || 'CHF',
            items: target.items || [],
            payment_method: target.payment_method || '',
            note: target.note || '',
            shipping: {
              method: target.shipping_method || '',
              address: target.shipping_address || '',
            },
            event_type: 'status_update',
            fulfillment_type: target.fulfillment_type || target.order_type || 'dine_in',
            order_type: target.order_type || target.fulfillment_type || 'dine_in',
            qr_order_number: target.qr_order_number || '',
            qr_service_day: target.qr_service_day || '',
            table_id: target.table_id || '',
            table_number: target.table_number || '',
            table_name: target.table_name || '',
            table_session_id: target.table_session_id || '',
            table_round_id: target.table_round_id || '',
            table_integration: target.table_integration || '',
            source: target.source || '',
            sound: false,
          }),
        });

        if (!response.ok) {
          throw new Error(`FoodUp table close status failed with HTTP ${response.status}`);
        }
      }

      setOrders(prev => prev.map(item =>
        String(item.table_session_id || '') === String(order.table_session_id || '')
          ? { ...item, status: 'table_completed' }
          : item
      ));

      setSelectedOrder(prev =>
        prev && String(prev.table_session_id || '') === String(order.table_session_id || '')
          ? { ...prev, status: 'table_completed' }
          : prev
      );
    } catch (e) {
      console.log(
        '[table-status] close table failed:',
        e instanceof Error ? e.message : String(e)
      );

      Alert.alert(
        t.error || 'Error',
        t.tableStatusSyncFailed || 'Table could not be closed. Please try again.'
      );
    }
  };


  const loadPickupReadyOrders = async () => {
    const stored = await AsyncStorage.getItem('pickup_ready_orders');
    if (stored) setPickupReadyOrders(JSON.parse(stored));
  };
  const loadPendingDecision = async () => {
    try {
      const stored = await AsyncStorage.getItem('pending_decision');
      if (stored) setPendingDecisionOrders(JSON.parse(stored));
    } catch (e) {}
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
    loadPendingDecision();
  }, []);

  const getDeliveryStatus = (order: Order) => {
    const claim = claims[String(order.order_id)];
    if (order.status === 'cancelled' || order.status === 'refunded') return 'cancelled';
    if (order.status === 'kitchen' && !claim) return 'kitchen';
    // Orders placed today before 03:00 are treated as done
    if (isTodayBeforeThreeAM(order.timestamp) && !claim) return 'delivered';
    if (!claim) return 'new';
    const status = typeof claim === 'string' ? 'delivering' : claim.status;
    const isPickup = isPickupMethod(order.shipping_method);
    if (status === 'delivered' && isPickup) return 'pickedUp';
    return status;
  };

  const getTableStatusPresentation = (order: Order) => {
    const raw = String(order.status || '').toLowerCase();

    if (['cancelled', 'refunded', 'rejected', 'failed'].includes(raw)) {
      return { label: t.cancelled || 'Cancelled', color: '#e74c3c', key: 'cancelled' };
    }
    if (['table_completed', 'closed'].includes(raw)) {
      return { label: t.completed || 'Completed', color: '#3498db', key: 'completed' };
    }
    if (['ready', 'ready_for_pickup'].includes(raw)) {
      return { label: t.ready || 'Ready', color: '#2fc053', key: 'ready' };
    }
    if (['kitchen', 'processing', 'preparing'].includes(raw)) {
      return { label: t.kitchen || 'Preparing', color: '#1976D2', key: 'preparing' };
    }
    if (acceptedTimes[String(order.order_id)]) {
      return { label: t.accepted || 'Accepted', color: '#8B38CB', key: 'accepted' };
    }
    return { label: t.newOrder || 'Received', color: '#f39c12', key: 'received' };
  };

  const getOrderStatusPresentation = (order: Order) => {
    if (isDineInOrder(order)) return getTableStatusPresentation(order);
    return {
      label: getDeliveryStatusLabel(claims[String(order.order_id)], order, t),
      color: getDeliveryStatusColor(claims[String(order.order_id)], order.status),
      key: getDeliveryStatus(order),
    };
  };

  const shouldShowKitchenButton = (order: Order) => {
    if (!canUseKitchen) return false;

    const currentStatus = getDeliveryStatus(order);
    const acceptedData = acceptedTimes[String(order.order_id)];

    if (!acceptedData) return false;
    if (order.status === 'cancelled' || order.status === 'refunded') return false;
    if (
      currentStatus === 'kitchen' ||
      currentStatus === 'in_bag' ||
      currentStatus === 'delivering' ||
      currentStatus === 'delivered' ||
      currentStatus === 'pickedUp'
    ) return false;

    const at = acceptedData.accepted_time || '';
    const isScheduledTime = at.includes('—') || (at.includes(':') && !at.includes('Minutes'));

    if (!isScheduledTime) return true;

    const parts = at.split('—');
    if (parts.length < 2) return false;

    const timePart = parts[0].trim();
    const dateParts = parts[1].trim().split('/');
    if (dateParts.length < 3) return false;

    const scheduledMs = new Date(`${dateParts[2]}-${dateParts[1]}-${dateParts[0]}T${timePart}:00`).getTime();
    if (!scheduledMs) return false;

    return scheduledMs - Date.now() <= 60 * 60 * 1000;
  };

  

  const filteredOrders = orders
    .filter(o => {
      // Orders older than today only appear in the "All" filter
      if (isOlderThanToday(o.timestamp) && filter !== 'all') return false;
      if (filter === 'today') {
        const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
        return new Date(o.timestamp) >= todayStart;
      }
      if (filter === 'table') return isDineInOrder(o);
      if (filter === 'scheduled') return isScheduledOrder(o) && o.status !== 'cancelled';
      if (filter === 'kitchen') return getDeliveryStatus(o) === 'kitchen';
      if (filter === 'auto') return !!autoPrintOrders[String(o.order_id)];
      return filter === 'all' || getDeliveryStatus(o) === filter;
    })
    .filter(o => {
      if (filter !== 'all') return true;
      if (!search.trim()) return true;
      const s = search.toLowerCase();
      return (
        String(o.order_id).includes(s) ||
        String(o.qr_order_number || '').includes(s) ||
        String(o.table_number || '').toLowerCase().includes(s) ||
        String(o.table_name || '').toLowerCase().includes(s) ||
        o.customer_name.toLowerCase().includes(s) ||
        o.customer_phone.toLowerCase().includes(s)
      );
    });
const sortedOrders = [...filteredOrders].sort((a, b) => {
  const aIsCancelled = getDeliveryStatus(a) === 'cancelled';
  const bIsCancelled = getDeliveryStatus(b) === 'cancelled';
  if (aIsCancelled && !bIsCancelled) return 1;
  if (!aIsCancelled && bIsCancelled) return -1;
  return b.order_id - a.order_id;
});
const sections = groupOrdersByDate(sortedOrders, t);

type FlatItem = { type: 'storeStatus' } | { type: 'searchBar' } | { type: 'filterTabs' } | { type: 'header'; title: string } | { type: 'order'; item: Order };

const flatData: FlatItem[] = [
  { type: 'storeStatus' },
  ...(filter === 'all' ? [{ type: 'searchBar' as const }] : []),
  { type: 'filterTabs' },
  ...sections.flatMap(section => [
    { type: 'header' as const, title: section.title },
    ...section.data.map(item => ({ type: 'order' as const, item })),
  ]),
];



  const todayStart = new Date(); todayStart.setHours(0, 0, 0, 0);
  const todayOrders = orders.filter(o => new Date(o.timestamp) >= todayStart);
  const filterCounts = {
    table: todayOrders.filter(o => isDineInOrder(o)).length,
    new: todayOrders.filter(o => getDeliveryStatus(o) === 'new').length,
    scheduled: todayOrders.filter(o => isScheduledOrder(o) && o.status !== 'cancelled').length,
    kitchen: todayOrders.filter(o => getDeliveryStatus(o) === 'kitchen').length,
    in_bag: todayOrders.filter(o => getDeliveryStatus(o) === 'in_bag').length,
    delivering: todayOrders.filter(o => getDeliveryStatus(o) === 'delivering').length,
    delivered: todayOrders.filter(o => getDeliveryStatus(o) === 'delivered').length,
    pickedUp: todayOrders.filter(o => getDeliveryStatus(o) === 'pickedUp').length,
    cancelled: todayOrders.filter(o => getDeliveryStatus(o) === 'cancelled').length,
    auto: todayOrders.filter(o => !!autoPrintOrders[String(o.order_id)]).length,
    all: orders.length,
    today: todayOrders.length,
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
            <TouchableOpacity onPress={() => {
              const claim = claims[String(selectedOrder.order_id)];
              const deliveredBy = claim?.status === 'delivered' ? claim.name : undefined;
              printOrder(selectedOrder, undefined, undefined, undefined, undefined, deliveredBy);
            }} style={styles.backCircle}>
              <Ionicons name="print-outline" size={20} color="#111" />
            </TouchableOpacity>
          ) : (
            <TouchableOpacity onPress={() => {
              const { Share } = require('react-native');
              Share.share({
                title: getQrOrderContextLabel(selectedOrder, t.table || 'Tisch') || getOrderPrimaryLabel(selectedOrder, t.orderNumber || 'Order'),
                message: `${getQrOrderContextLabel(selectedOrder, t.table || 'Tisch') || getOrderPrimaryLabel(selectedOrder, t.orderNumber || 'Order')}\nCustomer: ${selectedOrder.customer_name}\nPhone: ${formatPhone(selectedOrder.customer_phone)}\nAddress: ${selectedOrder.shipping_address}\nTotal: ${selectedOrder.currency} ${selectedOrder.total}\nPayment: ${selectedOrder.payment_method}\nItems: ${selectedOrder.items.map((i: any) => `${i.quantity}x ${i.name}`).join(', ')}${selectedOrder.note ? `\nNote: ${selectedOrder.note}` : ''}`,
              });
            }} style={styles.backCircle}>
              <Ionicons name="share-outline" size={20} color="#111" />
            </TouchableOpacity>
          )}
        </View>
        <SafeAreaView style={{ flex: 1 }}>
          <ScrollView contentContainerStyle={styles.scrollContent}>

            <Text style={styles.groupLabel}>{t.orderSummary || 'Order Summary'}</Text>
            {/* ── CARD (collapsed style, not tappable) ── */}
            <View style={[styles.section, { paddingTop: 14, paddingBottom: 14 }]}>
              <View style={styles.orderTopRow}>
                <Text style={styles.orderId}>{getQrOrderContextLabel(selectedOrder, t.table || 'Tisch') || getOrderPrimaryLabel(selectedOrder, t.orderNumber || 'Order')}</Text>
                {(() => {
                  const presentation = getOrderStatusPresentation(selectedOrder);
                  return (
                    <View style={[styles.statusPill, { backgroundColor: presentation.color + '20' }]}>
                      <Text style={[styles.statusPillText, { color: presentation.color }]}>
                        {presentation.label}
                      </Text>
                    </View>
                  );
                })()}
              </View>
              <View style={styles.divider} />
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                  <Ionicons name={isDineInOrder(selectedOrder) ? "restaurant-outline" : "person-outline"} size={Platform.OS === 'android' ? 13 : 14} color="#999" />
                  <Text style={styles.orderCustomer}>{isDineInOrder(selectedOrder) ? (getTableLabel(selectedOrder, t.table || 'Tisch') || 'Am Tisch') : selectedOrder.customer_name}</Text>
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
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 }}>
                <View style={styles.orderMeta}>
                  <Ionicons name="cash-outline" size={14} color="#999" />
                  <Text style={styles.orderTotal}>{selectedOrder.currency} {selectedOrder.total}</Text>
                </View>
                {(() => {
                  const isUnpaid = isUnpaidOrder(selectedOrder);
                  return (
                    <View style={styles.orderMeta}>
                      <Ionicons name={isUnpaid ? 'cash-outline' : 'card-outline'} size={14} color={isUnpaid ? '#e74c3c' : '#2ecc71'} />
                      <Text style={[styles.orderTotal, { color: isUnpaid ? '#e74c3c' : '#2ecc71' }]}>{isUnpaid ? t.notPaid : t.paidOnline}</Text>
                    </View>
                  );
                })()}
              </View>
              {!isDineInOrder(selectedOrder) && acceptedTimes[String(selectedOrder.order_id)] && (() => {
                const claim = claims[String(selectedOrder.order_id)];
                const status = claim ? (typeof claim === 'string' ? 'delivering' : claim.status) : 'new';
                const at = acceptedTimes[String(selectedOrder.order_id)].accepted_time || '';
                const isItemScheduled = at.includes('—') || (at.includes(':') && !at.includes('Minutes'));
                if (status === 'delivered' || selectedOrder.status === 'cancelled' || selectedOrder.status === 'refunded') return null;
                if (isItemScheduled) {
                  const scheduledMs = parseScheduledAcceptedTime(at);
                  if (!scheduledMs) return null;
                  return <ScheduledCountdown scheduledMs={scheduledMs} at={at} />;
                }
                return <OrderCountdown accepted_at={acceptedTimes[String(selectedOrder.order_id)].accepted_at} accepted_time={formatAcceptedTimeCompact(at)} />;
              })()}
              {(() => {
                if (selectedOrder.status === 'cancelled' || selectedOrder.status === 'refunded') {
                  return <View style={[styles.divider, { marginBottom: 0 }]} />;
                }
                const claim = claims[String(selectedOrder.order_id)];
                const status = claim ? (typeof claim === 'string' ? 'delivering' : claim.status) : 'new';
                const at = acceptedTimes[String(selectedOrder.order_id)]?.accepted_time || '';
                const hasCountdown = acceptedTimes[String(selectedOrder.order_id)] && status !== 'delivered';
                const isItemScheduled = at.includes('—') || (at.includes(':') && !at.includes('Minutes'));
                const scheduledMs = parseScheduledAcceptedTime(at);
                const showBar = isItemScheduled ? (scheduledMs ? (Date.now() > scheduledMs || (scheduledMs - Date.now()) <= 3600000) : false) : hasCountdown;
                if (!showBar) return <View style={[styles.divider, { marginBottom: 0 }]} />;
                return null;
              })()}
              <View style={styles.orderBottomRow}>
                {isDineInOrder(selectedOrder) ? (
                  <View style={styles.orderMeta}>
                    <Ionicons name="restaurant-outline" size={14} color="#999" />
                    <Text style={styles.orderShipping}>{getTableLabel(selectedOrder, t.table || 'Tisch') || (t.table || 'Tisch')}</Text>
                  </View>
                ) : selectedOrder.shipping_method ? (
                  <View style={styles.orderMeta}>
                    <Ionicons name={isPickupMethod(selectedOrder.shipping_method) ? 'bag-outline' : 'bicycle-outline'} size={14} color="#999" />
                    <Text style={styles.orderShipping}>{isPickupMethod(selectedOrder.shipping_method) ? t.pickupLabel : t.deliveryLabel}</Text>
                  </View>
                ) : <View />}
                {!isDineInOrder(selectedOrder) && claims[String(selectedOrder.order_id)] ? (
                  <View style={styles.orderMeta}>
                    {(() => {
                      const claim = claims[String(selectedOrder.order_id)];
                      const raw = typeof claim === 'string' ? claim : claim.name;
                      if (raw === 'Owner' || raw === '__owner__') return null;
                      const name = (() => { if (raw === 'Abgeholt' || raw === 'Picked Up' || raw === '__pickup__') return t.pickedUp; return raw; })();
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
            </View>

            {/* ── CUSTOMER SECTION ── */}
            {(selectedOrder.customer_email || selectedOrder.customer_phone || selectedOrder.shipping_address || selectedOrder.note) && (
              <>
                <Text style={styles.groupLabel}>{t.customer}</Text>
                <View style={styles.section}>
                  {autoPrintOrders[String(selectedOrder.order_id)] ? (
                    <>
                      <View style={styles.row}>
                        <Ionicons name="flash-outline" size={14} color="#8B38CB" />
                        <Text style={[styles.rowValue, { fontSize: Platform.OS === 'android' ? 12 : 14, color: '#8B38CB' }]}>Auto accepted: {formatAcceptedTimeCompact(autoPrintOrders[String(selectedOrder.order_id)].accepted_time)}</Text>
                      </View>
                      <View style={styles.divider} />
                    </>
                  ) : null}
                  {(() => {
                    const claim = claims[String(selectedOrder.order_id)];
                    if (claim && claim.status === 'delivered' && claim.delivered_at) {
                      return (
                        <>
                          <View style={styles.row}>
                            <Ionicons name="checkmark-circle-outline" size={14} color="#3498db" />
                            <Text style={[styles.rowValue, { fontSize: Platform.OS === 'android' ? 12 : 14, color: '#3498db' }]}>{t.deliveredAt} {formatISODate(claim.delivered_at)}</Text>
                          </View>
                          <View style={styles.divider} />
                        </>
                      );
                    }
                    return null;
                  })()}
                  {selectedOrder.customer_email ? (
                    <>
                      <TouchableOpacity style={styles.row} onPress={() => Linking.openURL(`mailto:${selectedOrder.customer_email}`)}>
                        <Ionicons name="mail-outline" size={14} color="#999" />
                        <Text style={[styles.rowValue, styles.linkValue, { fontSize: Platform.OS === 'android' ? 12 : 14 }]}>{selectedOrder.customer_email}</Text>
                      </TouchableOpacity>
                      <View style={styles.divider} />
                    </>
                  ) : null}
                  {selectedOrder.customer_phone ? (
                    <>
                      <TouchableOpacity style={styles.row} onPress={() => Linking.openURL(`tel:${selectedOrder.customer_phone}`)}>
                        <Ionicons name="call-outline" size={14} color="#999" />
                        <Text style={[styles.rowValue, styles.linkValue, { fontSize: Platform.OS === 'android' ? 12 : 14 }]}>{formatPhone(selectedOrder.customer_phone)}</Text>
                      </TouchableOpacity>
                      <View style={styles.divider} />
                    </>
                  ) : null}
                  {selectedOrder.shipping_address ? (
                    <>
                      <TouchableOpacity style={styles.row} onPress={() => { const encoded = encodeURIComponent(selectedOrder.shipping_address); Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${encoded}`); }}>
                        <Ionicons name="location-outline" size={14} color="#999" />
                        <Text style={[styles.rowValue, styles.linkValue, { fontSize: Platform.OS === 'android' ? 12 : 14 }]}>{formatAddress(selectedOrder.shipping_address)}</Text>
                      </TouchableOpacity>
                      {selectedOrder.date_created || selectedOrder.note ? <View style={styles.divider} /> : null}
                    </>
                  ) : null}
                  {selectedOrder.date_created ? (
                    <>
                      <View style={styles.row}>
                        <Ionicons name="time-outline" size={14} color="#999" />
                        <Text style={[styles.rowValue, { fontSize: Platform.OS === 'android' ? 12 : 14 }]}>{t.createdAt || 'Created'}: {formatDate(selectedOrder.date_created || selectedOrder.date || '')}</Text>
                      </View>
                      {selectedOrder.note ? <View style={styles.divider} /> : null}
                    </>
                  ) : null}
                  {selectedOrder.note ? (
                    <View style={styles.row}>
                      <View style={{ backgroundColor: '#fffbeb', borderRadius: 8, padding: 10, flex: 1, flexDirection: 'row', alignItems: 'flex-start', gap: 8, borderLeftWidth: 3, borderLeftColor: '#f39c12' }}>
                        <Ionicons name="alert-circle-outline" size={14} color="#f39c12" style={{ marginTop: 1 }} />
                        <Text style={{ fontSize: Platform.OS === 'android' ? 12 : 14, color: '#111', fontWeight: '600', flex: 1 }}>{selectedOrder.note}</Text>
                      </View>
                    </View>
                  ) : null}
                </View>
              </>
            )}

            {/* ── ITEMS SECTION ── */}
            {selectedOrder.items && selectedOrder.items.length > 0 && (
              <>
                <Text style={styles.groupLabel}>{t.items}</Text>
                <View style={styles.section}>
                  {selectedOrder.items.map((item, i) => (
                    <View key={i} style={[{ paddingVertical: 8, borderBottomWidth: i < selectedOrder.items.length - 1 ? 1 : 0, borderBottomColor: '#F0F0F0' }]}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                        <Text style={{ fontSize: Platform.OS === 'android' ? 12 : 14, fontWeight: '600', color: '#111', flex: 1 }}>{item.quantity}x {item.name}</Text>
                        <Text style={{ fontSize: Platform.OS === 'android' ? 12 : 14, fontWeight: '600', color: '#111' }}>{selectedOrder.currency} {parseFloat(String(item.total)).toFixed(2)}</Text>
                      </View>
                      {item.addons && item.addons.length > 0 && item.addons.map((addon, j) => (
                        <Text key={j} style={{ fontSize: Platform.OS === 'android' ? 11 : 12, color: '#666', paddingLeft: 8, marginTop: 2 }}>↳ {addon.label}: {addon.value}</Text>
                      ))}
                    </View>
                  ))}
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingTop: 8, marginTop: 4, borderTopWidth: 1, borderTopColor: '#F0F0F0' }}>
                    <Text style={styles.totalLabel}>{t.total}</Text>
                    <Text style={styles.totalValue}>{selectedOrder.currency} {selectedOrder.total}</Text>
                  </View>
                </View>
              </>
            )}


            {/* ── TABLE ORDER ACTION ── */}
            {isDineInOrder(selectedOrder) && (() => {
              const presentation = getTableStatusPresentation(selectedOrder);

              if (presentation.key === 'ready') {
                return (
                  <TouchableOpacity
                    style={{ backgroundColor: '#111', borderRadius: 12, padding: 16, alignItems: 'center', marginHorizontal: 16, marginBottom: 16, flexDirection: 'row', justifyContent: 'center', gap: 8 }}
                    onPress={() => {
                      Alert.alert(
                        'Tisch schliessen',
                        'Nur schliessen, wenn der Gast bezahlt hat und fertig ist.',
                        [
                          { text: t.cancel || 'Abbrechen', style: 'cancel' },
                          { text: 'Tisch Schliessen', onPress: () => void closeTableSession(selectedOrder) },
                        ]
                      );
                    }}
                  >
                    <Ionicons name="checkmark-done-circle-outline" size={18} color="#fff" />
                    <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>Tisch Schliessen</Text>
                  </TouchableOpacity>
                );
              }

              if (presentation.key === 'preparing') {
                return (
                  <TouchableOpacity
                    style={{ backgroundColor: '#2fc053', borderRadius: 12, padding: 16, alignItems: 'center', marginHorizontal: 16, marginBottom: 16, flexDirection: 'row', justifyContent: 'center', gap: 8 }}
                    onPress={() => markTableOrderReady(selectedOrder)}
                  >
                    <Ionicons name="checkmark-circle-outline" size={18} color="#fff" />
                    <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>{t.markReady}</Text>
                  </TouchableOpacity>
                );
              }

              if (presentation.key === 'accepted' && shouldShowKitchenButton(selectedOrder)) {
                return (
                  <TouchableOpacity
                    style={{ backgroundColor: '#1976D2', borderRadius: 12, padding: 16, alignItems: 'center', marginHorizontal: 16, marginBottom: 16, flexDirection: 'row', justifyContent: 'center', gap: 8 }}
                    onPress={() => moveOrderToKitchen(selectedOrder)}
                  >
                    <Ionicons name="restaurant-outline" size={18} color="#fff" />
                    <Text style={{ color: '#fff', fontSize: 15, fontWeight: '800' }}>{t.moveToKitchen}</Text>
                  </TouchableOpacity>
                );
              }

              return null;
            })()}

            {/* ── MARK DELIVERED / PICKUP BUTTON ── */}
            {(() => {
              if (isDineInOrder(selectedOrder)) return null;
              const claim = claims[String(selectedOrder.order_id)];
              const status = claim ? (typeof claim === 'string' ? 'delivering' : claim.status) : 'new';
              const acceptedData = acceptedTimes[String(selectedOrder.order_id)];
              const isOverdue = acceptedData ? (() => {
                const at = acceptedData.accepted_time || '';
                const isScheduledTime = at.includes('—') || (at.includes(':') && !at.includes('Minutes'));
                if (isScheduledTime) {
                  const scheduledMs = parseScheduledAcceptedTime(at);
                  if (scheduledMs === null) return false;
                  return Date.now() > scheduledMs;
                }
                const minutes = parseInt(at.replace(/[^0-9]/g, '') || '0');
                const acceptedAt = new Date(acceptedData.accepted_at).getTime();
                const deadline = acceptedAt + minutes * 60 * 1000;
                return Date.now() > deadline;
              })() : false;
              const isPickup = isPickupMethod(selectedOrder.shipping_method);
              const hasCourier = !!claim && (typeof claim === 'string' ? true : claim.name && claim.name !== 'Owner');
              if (status !== 'delivered' && selectedOrder.status !== 'cancelled' && (isPickup || (isOverdue && !hasCourier))) {
                return (
                  <TouchableOpacity
                    style={{ backgroundColor: isPickup ? '#2ecc71' : '#3498db', borderRadius: 12, padding: 16, alignItems: 'center', marginHorizontal: 16, marginBottom: 16, flexDirection: 'row', justifyContent: 'center', gap: 8 }}
                    onPress={async () => {
                      const isPickupReady = pickupReadyOrders[String(selectedOrder.order_id)];
                      if (isPickup && !isPickupReady) {
                        const markPickupReady = async (sendEmail: boolean) => {
                          const code = await AsyncStorage.getItem('restaurant_code') || '';
                          const restaurantProfile = await fetch(`${BACKEND_URL}/restaurant-profile/${code}`).then(r => r.json()).catch(() => ({}));
                          const website = restaurantProfile?.profile?.website;

                          if (!website) {
                            Alert.alert('Error', 'Restaurant website could not be loaded.');
                            return;
                          }

                          const baseUrl = website.startsWith('http') ? website : `https://${website}`;
                          const response = await fetch(`${baseUrl}/wp-json/foodup/v1/order-ready-pickup`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              secret: 'foodup2026',
                              order_id: selectedOrder.order_id,
                              send_email: sendEmail,
                            }),
                          });

                          const result = await response.json().catch(() => ({}));
                          if (!response.ok || result?.success === false) {
                            Alert.alert('Error', result?.message || 'Could not update order status.');
                            return;
                          }

                          const updated = { ...pickupReadyOrders, [String(selectedOrder.order_id)]: true };
                          setPickupReadyOrders(updated);
                          await AsyncStorage.setItem('pickup_ready_orders', JSON.stringify(updated));
                        };

                        setAlertConfig({
                          visible: true,
                          title: t.readyForPickup || 'Ready for Pickup',
                          message: t.readyForPickupMsg || 'Send an email to the customer that their order is ready?',
                          icon: 'bag-check-outline',
                          iconColor: '#2ecc71',
                          buttons: [
                            { text: t.sendEmail || 'Send Email', color: '#2ecc71', onPress: async () => { await markPickupReady(true); }},
                            { text: t.skipEmail || 'Skip Email', color: '#e74c3c', onPress: async () => { await markPickupReady(false); }},
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
                    <Ionicons name="checkmark-circle-outline" size={20} color="#fff" />
                    <Text style={{ color: '#fff', fontSize: Platform.OS === 'android' ? 13 : 15, fontWeight: '600' }}>
                      {isPickup ? (pickupReadyOrders[String(selectedOrder.order_id)] ? t.markPickedUp : t.readyForPickup || 'Ready for Pickup') : t.markDelivered}
                    </Text>
                  </TouchableOpacity>
                );
              }
              return null;
            })()}
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
        <View style={{ width: 80, alignItems: 'flex-end' }}>
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
          ) : null}
        </View>
      </View>
      <SafeAreaView style={{ flex: 1 }}>
        <FlatList
          ref={listRef}
          data={flatData}
          keyExtractor={(item, index) => item.type === 'order' ? String(item.item.order_id) : `header-${index}`}
          contentContainerStyle={styles.scrollContent}
          stickyHeaderIndices={[filter === 'all' ? 2 : 1]}
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
                      { key: 'today', label: t.today || 'Today', color: '#8B38CB' },
                      ...(tableOrderingEnabled ? [{ key: 'table', label: t.table || 'Tisch', color: '#6F2DBD' }] : []),
                      { key: 'new', label: t.newOrder, color: '#f39c12' },
                      { key: 'kitchen', label: t.kitchen || 'Kitchen', color: '#1976D2' },
                      { key: 'scheduled', label: t.scheduled || 'Scheduled', color: '#0097A7' },
                      { key: 'in_bag', label: t.inBag, color: '#2980b9' },
                      { key: 'delivering', label: t.delivering, color: '#16a085' },
                      { key: 'delivered', label: t.delivered, color: '#2fc053' },
                      { key: 'pickedUp', label: t.pickedUp || 'Picked Up', color: '#E91E63' },
                      { key: 'auto', label: 'Auto', color: '#795548' },
                      { key: 'cancelled', label: t.cancelled, color: '#e74c3c' },
                      { key: 'all', label: t.all, color: '#111' },
                    ]}
                    keyExtractor={f => f.key}
                    contentContainerStyle={{ paddingLeft: 10, paddingRight: 8, gap: 5, alignItems: 'center', paddingVertical: 10 }}
                    renderItem={({ item: f }) => (
                      <TouchableOpacity
                        onPress={() => {
                          setFilter(f.key);
                          if (f.key !== 'all') setSearch('');
                        }}
                        style={{ paddingLeft: 8, paddingRight: 5, paddingVertical: 5, borderRadius: 6, backgroundColor: filter === f.key ? f.color : f.key === 'all' ? '#F5F5F5' : f.color + '20', flexDirection: 'row', alignItems: 'center', gap: 4 }}
                      >
                        <Text style={{ fontSize: 11, fontWeight: '600', color: filter === f.key ? '#fff' : f.color === '#111' ? '#666' : f.color }} numberOfLines={1}>{f.label}</Text>
                        <View style={{ backgroundColor: '#fff', borderRadius: 3, minWidth: 18, height: 18, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 4 }}>
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
            return (
              <TouchableOpacity
                style={[styles.section, { paddingTop: 14, paddingBottom: 14 }]}
                onPress={() => setSelectedOrder(order)}
                activeOpacity={0.7}
              >
                <View style={styles.orderTopRow}>
                  <Text style={styles.orderId}>{getQrOrderContextLabel(order, t.table || 'Tisch') || getOrderPrimaryLabel(order, t.orderNumber || 'Order')}</Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    {autoPrintOrders[String(order.order_id)] && (
                      <View style={{ backgroundColor: '#79554820', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4 }}>
                        <Text style={{ fontSize: Platform.OS === 'android' ? 10 : 11, fontWeight: '600', color: '#795548' }}>{t.autoAccepted}</Text>
                      </View>
                    )}
                    {pendingDecisionOrders.includes(order.order_id) && (
                      <TouchableOpacity
                        onPress={async (e) => {
                          e.stopPropagation();
                          const code = String(await AsyncStorage.getItem('restaurant_code') || '').toLowerCase().trim();
                          setAcceptRejectOrder({ ...order, restaurant_code: order.restaurant_code || code });
                          setShowAcceptReject(true);
                        }}
                        style={{ backgroundColor: '#E91E6320', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, flexDirection: 'row', alignItems: 'center', gap: 4 }}
                      >
                        <Ionicons name="hand-left-outline" size={11} color="#E91E63" />
                        <Text style={{ fontSize: Platform.OS === 'android' ? 10 : 11, fontWeight: '600', color: '#E91E63' }}>
                          {t.review || 'Review'}
                        </Text>
                      </TouchableOpacity>
                    )}
                    {(() => {
                      const presentation = getOrderStatusPresentation(order);
                      return (
                        <View style={[styles.statusPill, { backgroundColor: presentation.color + '20' }]}>
                          <Text style={[styles.statusPillText, { color: presentation.color }]}>
                            {presentation.label}
                          </Text>
                        </View>
                      );
                    })()}
                  </View>
                </View>
                <View style={styles.divider} />
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    <Ionicons name={isDineInOrder(order) ? "restaurant-outline" : "person-outline"} size={14} color="#999" />
                    <Text style={styles.orderCustomer}>{isDineInOrder(order) ? (getTableLabel(order, t.table || 'Tisch') || 'Am Tisch') : order.customer_name}</Text>
                  </View>
                  {order.orderable_order_time ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Ionicons name={isScheduledOrder(order) ? 'calendar-outline' : 'flash-outline'} size={14} color={isScheduledOrder(order) ? '#8B38CB' : '#f39c12'} />
                      <Text style={{ fontSize: Platform.OS === 'android' ? 12 : 14, fontWeight: '700', color: isScheduledOrder(order) ? '#8B38CB' : '#f39c12' }}>
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
                    const isUnpaid = isUnpaidOrder(order);
                    return (
                      <View style={styles.orderMeta}>
                        <Ionicons name={isUnpaid ? 'cash-outline' : 'card-outline'} size={14} color={isUnpaid ? '#e74c3c' : '#2ecc71'} />
                        <Text style={[styles.orderTotal, { color: isUnpaid ? '#e74c3c' : '#2ecc71' }]}>{isUnpaid ? t.notPaid : t.paidOnline}</Text>
                      </View>
                    );
                  })()}
                </View>
                {isDineInOrder(order) ? (
                  <View
                    style={{
                      height: 1,
                      backgroundColor: '#E5E7EB',
                      marginTop: 10,
                      marginBottom: 2,
                      width: '100%',
                    }}
                  />
                ) : null}
                {order.note ? (
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6, backgroundColor: '#fffbeb', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 4, borderLeftWidth: 3, borderLeftColor: '#f39c12' }}>
                    <Ionicons name="alert-circle-outline" size={13} color="#f39c12" />
                    <Text style={{ fontSize: 12, color: '#111', fontWeight: '600', flex: 1 }} numberOfLines={1}>{order.note}</Text>
                  </View>
                ) : null}
                {!isDineInOrder(order) && acceptedTimes[String(order.order_id)] && (() => {
                  const claim = claims[String(order.order_id)];
                  const status = claim ? (typeof claim === 'string' ? 'delivering' : claim.status) : 'new';
                  const at = acceptedTimes[String(order.order_id)].accepted_time || '';
                  const isItemScheduled = at.includes('—') || (at.includes(':') && !at.includes('Minutes'));
                  if (status === 'delivered' || order.status === 'cancelled' || order.status === 'refunded') return null;
                  if (isItemScheduled) {
                    const scheduledMs = parseScheduledAcceptedTime(at);
                    if (!scheduledMs) return null;
                    return <ScheduledCountdown scheduledMs={scheduledMs} at={at} />;
                  }
                  return <OrderCountdown accepted_at={acceptedTimes[String(order.order_id)].accepted_at} accepted_time={formatAcceptedTimeCompact(at)} />;
                })()}
                {(() => {
                    const status = getDeliveryStatus(order);
                    if (status === 'delivered' || status === 'pickedUp' || status === 'cancelled') {
                      return <View style={[styles.divider, { marginBottom: 0 }]} />;
                    }
                    const at = acceptedTimes[String(order.order_id)]?.accepted_time || '';
                    const hasCountdown = !!acceptedTimes[String(order.order_id)];
                    const isItemScheduled = at.includes('—') || (at.includes(':') && !at.includes('Minutes'));
                    const scheduledMs = parseScheduledAcceptedTime(at);
                    const showBar = isItemScheduled
                      ? scheduledMs ? (Date.now() > scheduledMs || (scheduledMs - Date.now()) <= 3600000) : false
                      : hasCountdown;
                    if (!showBar) return <View style={[styles.divider, { marginBottom: 0 }]} />;
                    return null;
                  })()}
                <View style={styles.orderBottomRow}>
                  {isDineInOrder(order) ? (
                    <View style={styles.orderMeta}>
                      <Ionicons name="restaurant-outline" size={14} color="#999" />
                      <Text style={styles.orderShipping}>{getTableLabel(order, t.table || 'Tisch') || (t.table || 'Tisch')}</Text>
                    </View>
                  ) : order.shipping_method ? (
                    <View style={styles.orderMeta}>
                      <Ionicons name={isPickupMethod(order.shipping_method) ? 'bag-outline' : 'bicycle-outline'} size={14} color="#999" />
                      <Text style={styles.orderShipping}>{isPickupMethod(order.shipping_method) ? t.pickupLabel : t.deliveryLabel}</Text>
                    </View>
                  ) : <View />}

                  {(() => {
                    const claim = claims[String(order.order_id)];

                    if (!isDineInOrder(order) && claim) {
                      const raw = typeof claim === 'string' ? claim : claim.name;
                      if (raw === 'Owner' || raw === '__owner__') return null;

                      const name = (() => {
                        if (raw === 'Abgeholt' || raw === 'Picked Up' || raw === '__pickup__') return t.pickedUp;
                        return raw;
                      })();

                      const status = typeof claim === 'string' ? 'delivering' : claim.status;
                      const color = status === 'delivered' ? '#2fc053' : status === 'delivering' ? '#16a085' : '#2980b9';

                      return (
                        <View style={styles.orderMeta}>
                          <Ionicons name={status === 'delivered' ? 'checkmark-circle-outline' : status === 'delivering' ? 'car-outline' : 'bag-outline'} size={14} color={color} />
                          <Text style={[styles.courierName, { color: '#111' }]} numberOfLines={1}>{name}</Text>
                        </View>
                      );
                    }

                    if (isDineInOrder(order)) {
                      const presentation = getTableStatusPresentation(order);

                      if (presentation.key === 'preparing') {
                        return (
                          <TouchableOpacity
                            onPress={(e) => {
                              e.stopPropagation();
                              markTableOrderReady(order);
                            }}
                            activeOpacity={0.82}
                            style={{
                              backgroundColor: '#16A34A',
                              borderColor: '#15803D',
                              borderWidth: 1,
                              borderRadius: 8,
                              paddingHorizontal: 10,
                              paddingVertical: 6,
                              marginTop: 4,
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: 5,
                              shadowColor: '#000',
                              shadowOpacity: 0.12,
                              shadowRadius: 2,
                              shadowOffset: { width: 0, height: 1 },
                              elevation: 2,
                            }}
                          >
                            <Ionicons name="checkmark-circle" size={14} color="#fff" />
                            <Text style={{ color: '#fff', fontSize: Platform.OS === 'android' ? 10 : 11, fontWeight: '800' }}>
                              {t.markReady}
                            </Text>
                            <Ionicons name="chevron-forward" size={12} color="#fff" />
                          </TouchableOpacity>
                        );
                      }

                      if (presentation.key !== 'accepted' || !shouldShowKitchenButton(order)) return null;
                    } else if (!shouldShowKitchenButton(order)) {
                      return null;
                    }

                    return (
                      <TouchableOpacity
                        onPress={(e) => {
                          e.stopPropagation();
                          moveOrderToKitchen(order);
                        }}
                        activeOpacity={0.82}
                        style={{
                          backgroundColor: '#1976D2',
                          borderColor: '#1565C0',
                          borderWidth: 1,
                          borderRadius: 8,
                          paddingHorizontal: 10,
                          paddingVertical: 6,
                          marginTop: 4,
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 5,
                          shadowColor: '#000',
                          shadowOpacity: 0.10,
                          shadowRadius: 2,
                          shadowOffset: { width: 0, height: 1 },
                          elevation: 2,
                        }}
                      >
                        <Ionicons name="restaurant" size={13} color="#fff" />
                        <Text style={{ color: '#fff', fontSize: Platform.OS === 'android' ? 10 : 11, fontWeight: '800' }}>
                          {t.moveToKitchen}
                        </Text>
                        <Ionicons name="chevron-forward" size={12} color="#fff" />
                      </TouchableOpacity>
                    );
                  })()}
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
      <AcceptRejectModal
        order={acceptRejectOrder}
        visible={showAcceptReject}
        onDecisionStart={(orderId: number) => suppressOrderRingtone(orderRingtoneKey(acceptRejectOrder?.restaurant_code || '', orderId))}
        onDecisionFailed={(orderId: number) => releaseOrderRingtoneSuppression(orderRingtoneKey(acceptRejectOrder?.restaurant_code || '', orderId))}
        onClose={() => {
          setShowAcceptReject(false);
          setAcceptRejectOrder(null);
        }}
        onDecisionMade={(orderId: number) => {
          resolveOrderRingtone(orderRingtoneKey(acceptRejectOrder?.restaurant_code || '', orderId));
          setPendingDecisionOrders(prev => prev.filter(id => id !== orderId));
        }}
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
  headerPlaceholder: { width: 80 },
  backCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center' },
  backArrow: { fontSize: 24, color: '#111', lineHeight: 24, textAlignVertical: 'center', includeFontPadding: false },
  scrollContent: { paddingBottom: 40, paddingTop: 0 },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', gap: 10 },
  emptyText: { fontSize: 16, fontWeight: '600', color: '#333', marginTop: 8 },
  emptySubText: { fontSize: 14, color: '#999' },
  groupLabel: { fontSize: 13, fontWeight: '500', color: '#666', textTransform: 'uppercase', letterSpacing: 0.5, marginTop: 12, marginBottom: 6, marginHorizontal: 20 },
  section: { backgroundColor: '#fff', marginHorizontal: 16, marginBottom: 10, borderRadius: 14, paddingLeft: 16, paddingRight: 16, paddingTop: 12, paddingBottom: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.04, shadowRadius: 4, elevation: 1 },
  orderTopRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  orderId: { fontSize: Platform.OS === 'android' ? 15 : 14, color: '#666', fontWeight: '500' },
  statusPill: { borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  statusPillText: { fontSize: Platform.OS === 'android' ? 11 : 12, fontWeight: '600' },
  divider: { height: 1, backgroundColor: '#F0F0F0', marginVertical: 10 },
  orderCustomer: { fontSize: Platform.OS === 'android' ? 13 : 15, fontWeight: '700', color: '#111', marginBottom: 2 },
  orderFooter: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  orderTotal: { fontSize: Platform.OS === 'android' ? 12 : 14, fontWeight: '600', color: '#111' },
  orderShipping: { fontSize: Platform.OS === 'android' ? 12 : 14, color: '#111', fontWeight: '600' },
  orderDate: { fontSize: 13, color: '#999', alignSelf: 'center' },
  orderMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 },
  detailTitleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginHorizontal: 16, marginTop: 16, marginBottom: 4 },
  detailOrderId: { fontSize: 24, fontWeight: '700', color: '#111', letterSpacing: -0.5 },
  detailDate: { fontSize: 13, color: '#999', marginHorizontal: 16, marginBottom: 8 },
  statusBadge: { borderRadius: 8, paddingHorizontal: 12 },
  statusBadgeText: { fontSize: 13, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 6, },
  rowValue: { fontSize: Platform.OS === 'android' ? 12 : 14, color: '#111', fontWeight: '500', flex: 1 },
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
