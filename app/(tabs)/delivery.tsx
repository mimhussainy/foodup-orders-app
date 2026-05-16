import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';
import {
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView, ScrollView, StyleSheet, Text, TextInput,
  TouchableOpacity, View
} from 'react-native';
import { useLanguage } from '../../lib/useLanguage';

const BACKEND_URL = 'https://foodup-order-alerts-backend.onrender.com';

export default function AddOrderScreen() {
  const [orderId, setOrderId] = useState('');
  const [order, setOrder] = useState<any>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [addedToBag, setAddedToBag] = useState(false);
  const [deliveryName, setDeliveryName] = useState('');
  const { t } = useLanguage();

  useEffect(() => {
    AsyncStorage.getItem('delivery_name').then(n => setDeliveryName(n || ''));
  }, []);

  const getRestaurantCode = async () => {
    return (await AsyncStorage.getItem('restaurant_code')) || '';
  };

  const handleSearch = async () => {
    if (!orderId.trim()) return;

    Keyboard.dismiss();
    setLoading(true);
    setError('');
    setOrder(null);
    setAddedToBag(false);

    try {
      const code = await getRestaurantCode();
      const cleanOrderId = orderId.trim();

      const deliveredCheck = await fetch(`${BACKEND_URL}/check-delivered/${code}/${cleanOrderId}`);
      const deliveredResult = await deliveredCheck.json().catch(() => ({}));

      if (deliveredResult.delivered) {
        setOrder({
          order_id: cleanOrderId,
          already_delivered: true,
          delivery_name: deliveredResult.info?.delivery_name || '',
          delivered_at: deliveredResult.info?.delivered_at
            ? new Date(deliveredResult.info.delivered_at).toLocaleString()
            : '',
        });
        return;
      }

      const claimedCheck = await fetch(`${BACKEND_URL}/check-claimed/${code}/${cleanOrderId}`);
      const claimedResult = await claimedCheck.json().catch(() => ({}));

      if (
        claimedResult.claimed &&
        claimedResult.info?.delivery_name &&
        claimedResult.info.delivery_name !== deliveryName
      ) {
        setError(`${t.alreadyBeingDelivered} ${claimedResult.info.delivery_name}`);
        return;
      }

      const response = await fetch(`${BACKEND_URL}/order/${code}/${cleanOrderId}`);
      const result = await response.json().catch(() => ({}));

      if (result.success) {
        if (result.order.status === 'cancelled') {
          setError(t.orderCancelled);
          return;
        }

        if (
          result.order.shipping_method === 'Abholung' ||
          result.order.shipping?.method === 'Abholung'
        ) {
          setError(t.pickupOrder);
          return;
        }

        const stored = await AsyncStorage.getItem(`delivery_bag_${deliveryName}`);
        const bag = stored ? JSON.parse(stored) : [];

        const inBag = bag.find(
          (o: any) => String(o.order_id) === String(cleanOrderId)
        );

        if (inBag) {
          setError(t.alreadyInBag);
          return;
        }

        setOrder(result.order);
      } else {
        setError(t.orderNotFound);
      }
    } catch (e) {
      setError(t.connectionError);
    } finally {
      setLoading(false);
    }
  };

  const handleAddToBag = async () => {
    if (!order) return;

    if (!deliveryName) {
      setError('Delivery name is missing. Please log out and log back in.');
      return;
    }

    try {
      const code = await getRestaurantCode();

      const claimResponse = await fetch(`${BACKEND_URL}/claim-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: order.order_id,
          delivery_name: deliveryName,
          restaurant_code: code,
          delivery_status: 'in_bag',
        }),
      });

      const claimResult = await claimResponse.json().catch(() => ({}));

      if (!claimResult.success) {
        setError(claimResult.message || 'Could not claim this order.');
        return;
      }

      // Fetch accepted time from backend
      let accepted_time = '';
      let accepted_at = '';
      try {
        const acceptedRes = await fetch(`${BACKEND_URL}/accepted-time/${code}/${order.order_id}`);
        const acceptedResult = await acceptedRes.json();
        if (acceptedResult.success) {
          accepted_time = acceptedResult.accepted_time || '';
          accepted_at = acceptedResult.accepted_at || '';
        }
      } catch (e) {}

      const bagOrder = {
        order_id: order.order_id,
        customer_name: order.customer_name,
        customer_phone: order.customer_phone || '',
        address: order.shipping_address || order.shipping?.address || '',
        total: order.total,
        currency: order.currency,
        items: order.items || [],
        payment_method: order.payment_method || '',
        note: order.note || '',
        status: 'pending' as const,
        added_at: new Date().toLocaleString(),
        accepted_time,
        accepted_at,
      };

      const stored = await AsyncStorage.getItem(`delivery_bag_${deliveryName}`);
      const bag = stored ? JSON.parse(stored) : [];

      await AsyncStorage.setItem(
        `delivery_bag_${deliveryName}`,
        JSON.stringify([...bag, bagOrder])
      );

      setAddedToBag(true);
      setOrder(null);
      setOrderId('');
    } catch (e) {
      setError(t.connectionError);
    }
  };

  const handleClear = () => {
    setOrder(null);
    setOrderId('');
    setError('');
    setAddedToBag(false);
  };

  const shippingAddress =
    order?.shipping_address || order?.shipping?.address || '';

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
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          style={{ flex: 1 }}
        >
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.content}>
            <Text style={styles.greeting}>
              {t.hiCourier}, {deliveryName} 👋
            </Text>

            <Text style={styles.title}>{t.enterOrderId}</Text>

            <View style={styles.searchRow}>
              <TextInput
                style={styles.input}
                placeholder={t.orderIdPlaceholder}
                placeholderTextColor="#C0C0C0"
                keyboardType="numeric"
                value={orderId}
                onChangeText={text => {
                  setOrderId(text);
                  setError('');
                  setAddedToBag(false);
                }}
                onSubmitEditing={handleSearch}
                returnKeyType="search"
              />

              <TouchableOpacity
                style={styles.searchBtn}
                onPress={handleSearch}
                disabled={loading}
              >
                {loading 
                  ? <Text style={styles.searchBtnText}>···</Text>
                  : <Ionicons name="arrow-forward" size={22} color="#fff" />
                }
              </TouchableOpacity>
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}
            {addedToBag ? <Text style={styles.successText}>{t.addedToBag}</Text> : null}

            {order && !order.already_delivered && (
              <View style={styles.section}>
                <View style={styles.cardTopRow}>
                  <Text style={styles.cardTitle}>
                    Order #{order.order_id}
                  </Text>

                  <TouchableOpacity onPress={handleClear}>
                    <Text style={styles.closeBtn}>✕</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.divider} />

                {order.customer_name ? (
                  <View style={styles.row}>
                    <Ionicons name="person-outline" size={16} color="#999" />
                    <Text style={styles.rowValue}>{order.customer_name}</Text>
                  </View>
                ) : null}

                {order.customer_phone ? (
                  <View style={styles.row}>
                    <Ionicons name="call-outline" size={16} color="#999" />
                    <Text style={styles.rowValue}>{order.customer_phone}</Text>
                  </View>
                ) : null}

                {shippingAddress ? (
                  <View style={styles.row}>
                    <Ionicons name="location-outline" size={16} color="#999" />
                    <Text style={styles.rowValue}>{shippingAddress}</Text>
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

                {order.orderable_order_date || order.orderable_order_time ? (
                  <View style={styles.row}>
                    <Ionicons name="time-outline" size={16} color="#2ecc71" />
                    <Text style={[styles.rowValue, { color: '#2ecc71', fontWeight: '600' }]}>
                      {order.orderable_order_time?.toLowerCase().includes('as soon as possible') ? 'ASAP' : order.orderable_order_time?.replace(/\s*\(.*?\)\s*/g, '').trim()} — {order.orderable_order_date}
                    </Text>
                  </View>
                ) : null}
                {order.payment_method ? (
                  <View style={[styles.row, { borderBottomWidth: 0 }]}>
                    <Ionicons name="card-outline" size={16} color="#999" />
                    <Text style={styles.rowValue}>
                      {order.payment_method}
                    </Text>
                  </View>
                ) : null}

                {order.items?.length > 0 && (
                  <>
                    <View style={styles.divider} />
                    <Text style={styles.groupLabel}>{t.items}</Text>

                    {order.items.map((item: any, i: number) => (
                      <Text key={i} style={styles.itemText}>
                        {item.quantity}x {item.name}
                      </Text>
                    ))}
                  </>
                )}

                <TouchableOpacity
                  style={styles.primaryBtn}
                  onPress={handleAddToBag}
                >
                  <Text style={styles.primaryBtnText}>
                    {t.addToBag}
                  </Text>
                </TouchableOpacity>
              </View>
            )}

            {order?.already_delivered && (
              <View style={styles.section}>
                <View style={styles.cardTopRow}>
                  <Text style={styles.cardTitle}>
                    Order #{order.order_id}
                  </Text>

                  <TouchableOpacity onPress={handleClear}>
                    <Text style={styles.closeBtn}>✕</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.divider} />

                <View style={styles.deliveredBadge}>
                  <Text style={styles.deliveredBadgeText}>
                    {t.alreadyDelivered}
                  </Text>
                </View>

                {order.delivery_name ? (
                  <Text style={styles.deliveredInfo}>
                    By {order.delivery_name}
                  </Text>
                ) : null}

                {order.delivered_at ? (
                  <Text style={styles.deliveredTime}>
                    {order.delivered_at}
                  </Text>
                ) : null}

                <TouchableOpacity
                  style={styles.secondaryBtn}
                  onPress={handleClear}
                >
                  <Text style={styles.secondaryBtnText}>
                    {t.searchAnother}
                  </Text>
                </TouchableOpacity>
              </View>
            )}
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
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
  content: { paddingHorizontal: 20, paddingTop: 28, paddingBottom: 20 },
  greeting: { fontSize: 18, color: '#999', marginBottom: 4 },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111',
    marginBottom: 10,
    marginTop: 10,
  },
  searchRow: { flexDirection: 'row', gap: 10, marginBottom: 12 },
  input: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#E8E8E8',
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
    color: '#111',
    backgroundColor: '#FAFAFA',
  },
  searchBtn: {
    backgroundColor: '#111',
    borderRadius: 10,
    width: 52,
    height: 52,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchBtnText: { fontSize: 20, color: '#fff', includeFontPadding: false },
  error: { color: '#e74c3c', marginTop: 8 },
  successText: { color: '#2ecc71', marginTop: 8 },
  section: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginTop: 8,
  },
  cardTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  cardTitle: { fontSize: 17, fontWeight: '700' },
  closeBtn: { fontSize: 16, color: '#999' },
  divider: { height: 1, backgroundColor: '#F0F0F0', marginVertical: 12 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  rowValue: { flex: 1 },
  groupLabel: { fontSize: 13, color: '#666', marginBottom: 10 },
  itemText: { fontSize: 14, marginBottom: 4 },
  primaryBtn: {
    backgroundColor: '#111',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    marginTop: 14,
  },
  primaryBtnText: { color: '#fff' },
  deliveredBadge: {
    backgroundColor: '#f0fdf4',
    borderRadius: 8,
    padding: 10,
    alignItems: 'center',
  },
  deliveredBadgeText: { color: '#2ecc71', fontWeight: '700' },
  deliveredInfo: { textAlign: 'center', marginTop: 4 },
  deliveredTime: { textAlign: 'center', marginTop: 4 },
  secondaryBtn: {
    borderWidth: 1,
    borderColor: '#E8E8E8',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  secondaryBtnText: { color: '#111' },
});