import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Image, Keyboard, KeyboardAvoidingView, Linking, Platform,
  SafeAreaView, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View
} from 'react-native';
import { useLanguage } from '../../lib/useLanguage';

const BACKEND_URL = 'https://foodup-order-alerts-backend.onrender.com';

const SOUND_MAP: { [key: string]: string } = {
  default: 'https://assets.mixkit.co/active_storage/sfx/1045/1045.wav',
  data_scanner: 'https://assets.mixkit.co/active_storage/sfx/2847/2847.wav',
  security_alarm: 'https://assets.mixkit.co/active_storage/sfx/994/994.wav',
  classic_alarm: 'https://assets.mixkit.co/active_storage/sfx/995/995.wav',
  slot_machine: 'https://assets.mixkit.co/active_storage/sfx/1995/1995.wav',
};
let previewSoundRef: any = null;

async function previewSound(key: string) {
  try {
    if (previewSoundRef) {
      await previewSoundRef.stopAsync().catch(() => {});
      await previewSoundRef.unloadAsync().catch(() => {});
      previewSoundRef = null;
    }

    const uri = SOUND_MAP[key];
    if (!uri) return;

    const { sound } = await Audio.Sound.createAsync({ uri });
    previewSoundRef = sound;
    await sound.playAsync();

    sound.setOnPlaybackStatusUpdate((status: any) => {
      if (status.isLoaded && status.didJustFinish) {
        sound.unloadAsync();
        previewSoundRef = null;
      }
    });
  } catch (e) {}
}

export default function SettingsScreen() {
  const router = useRouter();
  const { language, t, changeLanguage } = useLanguage();

  const SOUNDS = [
    { key: 'default', label: t.default, icon: 'notifications-outline' },
    { key: 'data_scanner', label: 'Data Scanner', icon: 'scan-outline' },
    { key: 'security_alarm', label: 'Security Alarm', icon: 'shield-outline' },
    { key: 'classic_alarm', label: 'Classic Alarm', icon: 'alarm-outline' },
    { key: 'slot_machine', label: 'Slot Machine', icon: 'musical-notes-outline' },
  ];

  const [role, setRole] = useState('');
  const scrollRef = useRef<any>(null);

  useFocusEffect(
    useCallback(() => {
      setTimeout(() => {
        try { scrollRef.current?.scrollTo({ y: 0, animated: true }); } catch (e) {}
      }, 300);
    }, [])
  );
  const [restaurantCode, setRestaurantCode] = useState('');
  const [accounts, setAccounts] = useState<any[]>([]);
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [showAbout, setShowAbout] = useState(false);
  const [showSound, setShowSound] = useState(false);
  const [showAllCouriers, setShowAllCouriers] = useState(false);
  const [showAddCourier, setShowAddCourier] = useState(false);
  const [showAcceptanceTimes, setShowAcceptanceTimes] = useState(false);
  const [openSection, setOpenSection] = useState<string | null>(null);

  const toggleSection = (section: string) => {
    setOpenSection(prev => prev === section ? null : section);
  };
  const [deliveryName, setDeliveryName] = useState('');
  const [resetTarget, setResetTarget] = useState<string | null>(null);
  const [newResetPassword, setNewResetPassword] = useState('');
  const [resetError, setResetError] = useState('');
  const [resetSuccess, setResetSuccess] = useState('');
  const [resetLoading, setResetLoading] = useState(false);
  const [notificationSound, setNotificationSound] = useState('default');
  const [changingLanguage, setChangingLanguage] = useState(false);
  const [showLanguage, setShowLanguage] = useState(false);
  const [restaurantName, setRestaurantName] = useState('');
  const [restaurantPhone, setRestaurantPhone] = useState('');
  const [restaurantAddress, setRestaurantAddress] = useState('');
  const [restaurantHours, setRestaurantHours] = useState('');
  const [restaurantWebsite, setRestaurantWebsite] = useState('');
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileSuccess, setProfileSuccess] = useState('');
  const [profileError, setProfileError] = useState('');
  const [showRestaurantForm, setShowRestaurantForm] = useState(false);
  const [storeIsOpen, setStoreIsOpen] = useState<boolean | null>(null);
  const [storeLoading, setStoreLoading] = useState(false);
  const [acceptanceTimes, setAcceptanceTimes] = useState<number[]>([15, 20, 25, 30, 45, 60]);
  const [newAcceptanceTime, setNewAcceptanceTime] = useState('');
  const [products, setProducts] = useState<any[]>([]);
  const [productsLoading, setProductsLoading] = useState(false);
  const [showProducts, setShowProducts] = useState(false);
  const [togglingProduct, setTogglingProduct] = useState<number | null>(null);
  const [openCategory, setOpenCategory] = useState<string | null>(null);
  const [deviceId, setDeviceId] = useState('');
  const [checkingPrinter, setCheckingPrinter] = useState(false);

  const getPin = async () => {
    const iosPin = await AsyncStorage.getItem('ios_pin') || '';
    const ownerPin = await AsyncStorage.getItem('owner_pin') || '';
    return iosPin || ownerPin;
  };

  useEffect(() => {
    AsyncStorage.getItem('restaurant_code').then(c => {
      setRestaurantCode(c || '');
      if(c) {
        fetch(`${BACKEND_URL}/store-status/${c}`)
          .then(r => r.json())
          .then(result => { if(result.success) setStoreIsOpen(result.is_open); })
          .catch(() => {});
      }
    });

    AsyncStorage.getItem('user_role').then(r => {
      setRole(r || '');

      if (r === 'owner') {
        loadAccounts();
        loadRestaurantProfile();
      }

      if (r === 'delivery') {
        loadRestaurantProfile();
      }
    });

    AsyncStorage.getItem('delivery_name').then(n => setDeliveryName(n || ''));
    AsyncStorage.getItem('notification_sound').then(s => setNotificationSound(s || 'default'));
    if (Platform.OS === 'android') {
      const Application = require('expo-application');
      const id = Application.getAndroidId();
      setDeviceId(id || '');
      if (id) AsyncStorage.setItem('device_id', id);
    }
    AsyncStorage.getItem('restaurant_code').then(async code => {
      if (!code) return;
      try {
        const res = await fetch(`https://foodup-order-alerts-backend.onrender.com/acceptance-times/${code}`);
        const result = await res.json();
        if (result.success) setAcceptanceTimes(result.times);
      } catch (e) {}
    });
  }, []);

  const loadAccounts = async () => {
    const ownerPin = await AsyncStorage.getItem('owner_pin') || '';
    const iosPin = await AsyncStorage.getItem('ios_pin') || '';
    const pin = iosPin || ownerPin;
    const code = await AsyncStorage.getItem('restaurant_code') || '';

    try {
      const endpoint = Platform.OS === 'ios'
        ? `${BACKEND_URL}/delivery-accounts-ios?ios_pin=${pin}&restaurant_code=${code}`
        : `${BACKEND_URL}/delivery-accounts?owner_pin=${ownerPin}&restaurant_code=${code}`;
      const response = await fetch(endpoint);
      const result = await response.json();
      if (result.success) setAccounts(result.accounts);
    } catch (e) {}
  };
  const loadProducts = async () => {
    if (!restaurantWebsite) return;
    setProductsLoading(true);
    try {
      const website = restaurantWebsite.startsWith('http') ? restaurantWebsite : `https://${restaurantWebsite}`;
      const res = await fetch(`${website}/wp-json/foodup/v1/products?secret=foodup2026`);
      const result = await res.json();
      if (result.success) setProducts(result.products);
    } catch (e) {}
    setProductsLoading(false);
  };

  const toggleProduct = async (productId: number, enabled: boolean) => {
    setTogglingProduct(productId);
    try {
      const website = restaurantWebsite.startsWith('http') ? restaurantWebsite : `https://${restaurantWebsite}`;
      const res = await fetch(`${website}/wp-json/foodup/v1/product-toggle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ secret: 'foodup2026', product_id: productId, enabled }),
      });
      const result = await res.json();
      if (result.success) {
        setProducts(prev => prev.map(p => p.id === productId ? { ...p, enabled } : p));
      }
    } catch (e) {}
    setTogglingProduct(null);
  };
  const loadRestaurantProfile = async () => {
    try {
      const code = await AsyncStorage.getItem('restaurant_code') || '';

      const response = await fetch(`${BACKEND_URL}/restaurant-profile/${code}`);
      const result = await response.json();

      if (result.success) {
        setRestaurantName(result.profile.name || '');
        setRestaurantPhone(result.profile.phone || '');
        setRestaurantAddress(result.profile.address || '');
        setRestaurantHours(result.profile.hours || '');
        setRestaurantWebsite(result.profile.website || '');
        // Fetch store status
        if (result.profile.website) {
          const website = result.profile.website.startsWith('http') ? result.profile.website : `https://${result.profile.website}`;
          const statusRes = await fetch(`${website}/foodup-store-status.php`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ secret: 'foodup2026', action: 'get' }),
          });
          const statusResult = await statusRes.json();
          if (statusResult.success) setStoreIsOpen(statusResult.is_open);
        }
      }
    } catch (e) {}
  };
  const handleAddAccount = async () => {
    Keyboard.dismiss();

    if (!newUsername.trim() || !newPassword.trim()) {
      setError(t.enterUsernamePassword);
      return;
    }

    setLoading(true);
    setError('');
    setSuccess('');

    const pin = await getPin();
    const code = await AsyncStorage.getItem('restaurant_code') || '';

    try {
      const response = await fetch(`${BACKEND_URL}/add-delivery-account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username:
            newUsername.trim().charAt(0).toUpperCase() +
            newUsername.trim().slice(1),
          password: newPassword.trim(),
          owner_pin: pin,
          restaurant_code: code,
        }),
      });

      const result = await response.json();

      if (result.success) {
        setSuccess(t.accountCreated);
        setNewUsername('');
        setNewPassword('');
        loadAccounts();
      } else {
        setError(result.message || 'Failed to create account');
      }
    } catch (e) {
      setError(t.connectionError);
    }

    setLoading(false);
  };

  const handleSaveRestaurantProfile = async () => {
    Keyboard.dismiss();

    setProfileLoading(true);
    setProfileError('');
    setProfileSuccess('');

    const pin = await getPin();
    const code = await AsyncStorage.getItem('restaurant_code') || '';

    try {
      const response = await fetch(`${BACKEND_URL}/restaurant-profile`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          owner_pin: pin,
          restaurant_code: code,
          name: restaurantName.trim(),
          phone: restaurantPhone.trim(),
          address: restaurantAddress.trim(),
          hours: restaurantHours.trim(),
          website: restaurantWebsite.trim(),
        }),
      });

      const result = await response.json();

      if (result.success) {
        setProfileSuccess(t.profileSaved);
        setShowRestaurantForm(false);
        setTimeout(() => setProfileSuccess(''), 2000);
      } else {
        setProfileError('Failed to save profile');
      }
    } catch (e) {
      setProfileError(t.connectionError);
    }

    setProfileLoading(false);
  };

  const handleDeleteAccount = async (username: string) => {
    Alert.alert(
      t.removeCourier,
      `${t.removeCourierConfirm} ${username.charAt(0).toUpperCase() + username.slice(1)}?`,
      [
        { text: t.cancel, style: 'cancel' },
        {
          text: t.remove,
          style: 'destructive',
          onPress: async () => {
            const pin = await getPin();
            const code = await AsyncStorage.getItem('restaurant_code') || '';

            try {
              await fetch(`${BACKEND_URL}/delete-delivery-account`, {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  username,
                  owner_pin: pin,
                  restaurant_code: code,
                }),
              });

              loadAccounts();
            } catch (e) {}
          },
        },
      ]
    );
  };

  const handleResetPassword = async (username: string) => {
    if (!newResetPassword.trim()) {
      setResetError('Please enter a new password');
      return;
    }

    setResetLoading(true);
    setResetError('');
    setResetSuccess('');

    const pin = await getPin();
    const code = await AsyncStorage.getItem('restaurant_code') || '';

    try {
      const response = await fetch(`${BACKEND_URL}/reset-delivery-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          new_password: newResetPassword.trim(),
          owner_pin: pin,
          restaurant_code: code,
        }),
      });

      const result = await response.json();

      if (result.success) {
        setResetSuccess(t.passwordUpdated);
        setNewResetPassword('');

        setTimeout(() => {
          setResetTarget(null);
          setResetSuccess('');
        }, 1500);
      } else {
        setResetError(result.message || 'Failed to reset password');
      }
    } catch (e) {
      setResetError(t.connectionError);
    }

    setResetLoading(false);
  };

  const checkPrinterPairing = async () => {
    setCheckingPrinter(true);
    try {
      const Application = require('expo-application');
      const currentDeviceId = Application.getAndroidId() || '';
      const code = await AsyncStorage.getItem('restaurant_code') || '';
      const res = await fetch(`${BACKEND_URL}/printer-device/${code}`);
      const result = await res.json();
      const registeredDeviceId = result.success ? (result.device_id || '') : '';

      if (registeredDeviceId && registeredDeviceId === currentDeviceId) {
        Alert.alert(
          '✅ Printer Paired',
          `This device is registered as the printer for ${restaurantName || 'this restaurant'}.`
        );
      } else {
        Alert.alert(
          '⚠️ Not Registered as Printer',
          `This device is not registered as the printer.\n\nRegistered ID: ${registeredDeviceId || 'none'}\nThis device's ID: ${currentDeviceId}`,
          [
            { text: 'Close', style: 'cancel' },
            {
              text: 'Email Device ID',
              onPress: () => {
                const subject = encodeURIComponent(`Printer Device ID Update - ${code}`);
                const body = encodeURIComponent(
                  `Restaurant Code: ${code}\nRestaurant Name: ${restaurantName || ''}\n\nRegistered Device ID: ${registeredDeviceId || 'none'}\nCurrent Device ID: ${currentDeviceId}`
                );
                Linking.openURL(`mailto:info@foodup.ch?subject=${subject}&body=${body}`);
              },
            },
          ]
        );
      }
    } catch (e) {
      Alert.alert('Error', t.connectionError);
    }
    setCheckingPrinter(false);
  };

  const handleLogout = async () => {
    // Unregister push token before logout
    try {
      const { Notifications } = require('expo-notifications');
      const token = (await Notifications.getExpoPushTokenAsync({
        projectId: 'a057b1fa-8571-453c-a989-a4de0c33949a',
      })).data;
      const code = await AsyncStorage.getItem('restaurant_code') || '';
      if (token && code) {
        await fetch(`${BACKEND_URL}/unregister-token`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token, restaurant_code: code }),
        });
      }
    } catch (e) {}

    const ordersHistory = await AsyncStorage.getItem('foodup_orders');
    const deliveryHistory = await AsyncStorage.getItem('delivery_history');
    const restaurantCode = await AsyncStorage.getItem('restaurant_code');
    const notificationSoundPref = await AsyncStorage.getItem('notification_sound');
    const pickupReadyOrders = await AsyncStorage.getItem('pickup_ready_orders');
    const pendingDecision = await AsyncStorage.getItem('pending_decision');

    // Save all delivery bags before clearing
    const allKeys = await AsyncStorage.getAllKeys();
    const bagKeys = allKeys.filter(k => k.startsWith('delivery_bag_'));
    const bagEntries: [string, string][] = [];
    for (const key of bagKeys) {
      const val = await AsyncStorage.getItem(key);
      if (val) bagEntries.push([key, val]);
    }

    await AsyncStorage.clear();

    if (ordersHistory) await AsyncStorage.setItem('foodup_orders', ordersHistory);
    if (deliveryHistory) await AsyncStorage.setItem('delivery_history', deliveryHistory);
    if (restaurantCode) await AsyncStorage.setItem('restaurant_code', restaurantCode);
    if (notificationSoundPref) await AsyncStorage.setItem('notification_sound', notificationSoundPref);
    if (pickupReadyOrders) await AsyncStorage.setItem('pickup_ready_orders', pickupReadyOrders);
    if (pendingDecision) await AsyncStorage.setItem('pending_decision', pendingDecision);
    for (const [key, val] of bagEntries) {
      await AsyncStorage.setItem(key, val);
    }

    router.replace('/onboarding');
  };
const stopPreviewSound = async () => {
    if (previewSoundRef) {
      await previewSoundRef.stopAsync().catch(() => {});
      await previewSoundRef.unloadAsync().catch(() => {});
      previewSoundRef = null;
    }
  };

  useFocusEffect(
    useCallback(() => {
      return () => {
        stopPreviewSound();
      };
    }, [])
  );
  const currentSoundLabel =
    SOUNDS.find(s => s.key === notificationSound)?.label || t.default;

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
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={{ flex: 1 }}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 90 : 0}
        >
        <ScrollView ref={scrollRef} contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled" automaticallyAdjustKeyboardInsets={true}>
          {role === 'delivery' && (
            <>
              <Text style={styles.groupLabel}>{t.profile}</Text>

              <View style={styles.section}>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10, paddingVertical: 14 }}>
                  <Ionicons name="person-circle-outline" size={32} color="#999" style={{ marginTop: 2 }} />
                  <View>
                    <Text style={styles.profileName}>{deliveryName}</Text>
                    <Text style={styles.profileRole}>{t.courier}</Text>
                  </View>
                </View>
              </View>

              {(restaurantName || restaurantPhone || restaurantAddress || restaurantWebsite) && (
                <>
                  <Text style={styles.groupLabel}>{t.restaurant}</Text>

                  <View style={styles.section}>
                    {restaurantName ? (
                      <View style={styles.row}>
                        <Ionicons name="storefront-outline" size={16} color="#999" />
                        <Text style={styles.rowValue}>{restaurantName}</Text>
                      </View>
                    ) : null}

                    {restaurantPhone ? (
                      <TouchableOpacity style={styles.row} onPress={() => Linking.openURL(`tel:${restaurantPhone}`)}>
                        <Ionicons name="call-outline" size={16} color="#999" />
                        <Text style={[styles.rowValue, { color: '#007AFF' }]}>{restaurantPhone}</Text>
                      </TouchableOpacity>
                    ) : null}

                    {restaurantAddress ? (
                      <TouchableOpacity
                        style={styles.row}
                        onPress={() => {
                          const encoded = encodeURIComponent(restaurantAddress);
                          Linking.openURL(`https://www.google.com/maps/dir/?api=1&destination=${encoded}`);
                        }}
                      >
                        <Ionicons name="location-outline" size={16} color="#999" />
                        <Text style={[styles.rowValue, { color: '#007AFF' }]}>{restaurantAddress}</Text>
                      </TouchableOpacity>
                    ) : null}

                    {restaurantWebsite ? (
                      <TouchableOpacity
                        style={[styles.row, { borderBottomWidth: 0 }]}
                        onPress={() => Linking.openURL(`https://${restaurantWebsite}`)}
                      >
                        <Ionicons name="globe-outline" size={16} color="#999" />
                        <Text style={[styles.rowValue, { color: '#007AFF' }]}>{restaurantWebsite}</Text>
                      </TouchableOpacity>
                    ) : null}
                  </View>
                </>
              )}
            </>
          )}

          {role === 'owner' && storeIsOpen !== null && (
            <>
              <Text style={styles.groupLabel}>{t.storeStatus}</Text>
              <View style={styles.section}>
                <View style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 14 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 15, fontWeight: '600', color: '#111' }}>
                      {storeIsOpen ? t.storeOpen : t.storeClosed}
                    </Text>
                    <Text style={{ fontSize: 13, color: '#999', marginTop: 2 }}>
                      {storeIsOpen ? t.storeOpenSub : t.storeClosedSub}
                    </Text>
                  </View>
                  <TouchableOpacity
                    onPress={async () => {
                      if (storeLoading) return;
                      setStoreLoading(true);
                      try {
                        const pin = await AsyncStorage.getItem('owner_pin') || '';
                        const code = await AsyncStorage.getItem('restaurant_code') || '';
                        const response = await fetch(`${BACKEND_URL}/store-status`, {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ restaurant_code: code, is_open: !storeIsOpen }),
                        });
                        const result = await response.json();
                        if (result.success) {
                          const newIsOpen = result.is_open;
                          setStoreIsOpen(newIsOpen);
                          if(restaurantWebsite) {
                            const website = restaurantWebsite.startsWith('http') ? restaurantWebsite : `https://${restaurantWebsite}`;
                            fetch(`${website}/foodup-store-status.php`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ secret: 'foodup2026', action: 'set', is_open: newIsOpen, restaurant_code: code }),
                            }).catch(() => {});
                          }
                        }
                      } catch (e) {}
                      setStoreLoading(false);
                    }}
                    style={{ opacity: storeLoading ? 0.6 : 1 }}
                  >
                    <View style={{
                      width: 51,
                      height: 31,
                      borderRadius: 16,
                      backgroundColor: storeIsOpen ? '#8B38CB' : '#ddd',
                      justifyContent: 'center',
                      paddingHorizontal: 2,
                    }}>
                      <View style={{
                        width: 27,
                        height: 27,
                        borderRadius: 14,
                        backgroundColor: '#fff',
                        alignSelf: storeIsOpen ? 'flex-end' : 'flex-start',
                        shadowColor: '#000',
                        shadowOpacity: 0.15,
                        shadowRadius: 2,
                        elevation: 2,
                        justifyContent: 'center',
                        alignItems: 'center',
                      }}>
                        {storeIsOpen && <Ionicons name="checkmark" size={16} color="#8B38CB" />}
                      </View>
                    </View>
                  </TouchableOpacity>
                </View>
              </View>
            </>
          )}

          {role === 'owner' && (
            <>
              <Text style={styles.groupLabel}>{t.addCourierAccount}</Text>

              <View style={styles.section}>
                <TouchableOpacity
                  style={[styles.row, { borderBottomWidth: openSection === 'addCourier' ? 1 : 0 }]}
                  onPress={() => toggleSection('addCourier')}
                >
                  <Ionicons name="person-add-outline" size={18} color="#999" />
                  <Text style={[styles.rowValue, { flex: 1 }]}>{t.addCourierAccount}</Text>
                  <Text style={styles.chevron}>{openSection === 'addCourier' ? '▲' : '▼'}</Text>
                </TouchableOpacity>

                {openSection === 'addCourier' && (
                  <View style={{ paddingVertical: 12 }}>
                    <View style={{ flexDirection: 'row', gap: 10 }}>
                      <TextInput
                        style={[styles.input, { flex: 1, marginTop: 0 }]}
                        placeholder={t.username}
                        placeholderTextColor={Platform.OS === 'ios' ? '#ADADAD' : '#C0C0C0'}
                        value={newUsername}
                        onChangeText={setNewUsername}
                        autoCapitalize="none"
                      />
                      <TextInput
                        style={[styles.input, { flex: 1, marginTop: 0 }]}
                        placeholder={t.password}
                        placeholderTextColor={Platform.OS === 'ios' ? '#ADADAD' : '#C0C0C0'}
                        value={newPassword}
                        onChangeText={setNewPassword}
                        secureTextEntry
                      />
                    </View>
                    {error ? <Text style={styles.error}>{error}</Text> : null}
                    {success ? <Text style={styles.successText}>{success}</Text> : null}
                    <TouchableOpacity style={styles.primaryBtn} onPress={handleAddAccount} disabled={loading}>
                      <Text style={styles.primaryBtnText}>{loading ? t.adding : t.addAccount}</Text>
                    </TouchableOpacity>
                  </View>
                )}
              </View>
            </>
          )}

          {role === 'owner' && accounts.length > 0 && (
            <>
              <Text style={styles.groupLabel}>{t.courierAccounts}</Text>

              <View style={styles.section}>
                <TouchableOpacity
                  style={[styles.row, { borderBottomWidth: openSection === 'couriers' ? 1 : 0 }]}
                  onPress={() => toggleSection('couriers')}
                >
                  <Ionicons name="people-outline" size={18} color="#999" />
                  <Text style={[styles.rowValue, { flex: 1 }]}>{accounts.length} {t.courierAccounts}</Text>
                  <Text style={styles.chevron}>{openSection === 'couriers' ? '▲' : '▼'}</Text>
                </TouchableOpacity>

                {openSection === 'couriers' && accounts.map((account, i, arr) => (
                  <View key={i}>
                    <View
                      style={[
                        styles.row,
                        i === arr.length - 1 &&
                          !resetTarget &&
                          !(!showAllCouriers && accounts.length > 3) && { borderBottomWidth: 0 },
                      ]}
                    >
                      <Ionicons name="person-outline" size={16} color="#999" />

                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowValue}>
                          {account.username.charAt(0).toUpperCase() + account.username.slice(1)}
                        </Text>
                        {account.phone ? (
                          <TouchableOpacity onPress={() => Linking.openURL(`tel:${account.phone}`)}>
                            <Text style={{ fontSize: 12, color: '#007AFF', marginTop: 2 }}>
                              {(() => {
                                let p = account.phone.replace(/\s+/g, '').replace(/[^0-9+]/g, '');
                                if (p.startsWith('+41')) p = '0' + p.slice(3);
                                else if (p.startsWith('41')) p = '0' + p.slice(2);
                                if (p.length === 10) p = p.slice(0,3) + ' ' + p.slice(3,6) + ' ' + p.slice(6,8) + ' ' + p.slice(8,10);
                                return p;
                              })()}
                            </Text>
                          </TouchableOpacity>
                        ) : (
                          <Text style={{ fontSize: 12, color: '#e74c3c', marginTop: 2 }}>No phone set</Text>
                        )}
                      </View>

                      <TouchableOpacity
                        onPress={() => {
                          setResetTarget(resetTarget === account.username ? null : account.username);
                          setResetError('');
                          setResetSuccess('');
                          setNewResetPassword('');
                        }}
                      >
                        <Ionicons name="key-outline" size={16} color="#007AFF" />
                      </TouchableOpacity>

                      <View style={{ width: 8 }} />

                      <TouchableOpacity onPress={() => handleDeleteAccount(account.username)}>
                        <Ionicons name="trash-outline" size={16} color="#e74c3c" />
                      </TouchableOpacity>
                    </View>

                    {resetTarget === account.username && (
                      <View style={[styles.resetBox, i === arr.length - 1 && { borderBottomWidth: 0 }]}>
                        <TextInput
                          style={styles.resetInput}
                          placeholder={t.newPassword}
                          placeholderTextColor={Platform.OS === 'ios' ? '#ADADAD' : '#C0C0C0'}
                          value={newResetPassword}
                          onChangeText={setNewResetPassword}
                          secureTextEntry
                          autoFocus
                        />

                        {resetError ? <Text style={styles.error}>{resetError}</Text> : null}
                        {resetSuccess ? <Text style={styles.successText}>{resetSuccess}</Text> : null}

                        <TouchableOpacity
                          style={styles.primaryBtn}
                          onPress={() => handleResetPassword(account.username)}
                          disabled={resetLoading}
                        >
                          <Text style={styles.primaryBtnText}>
                            {resetLoading ? t.saving : t.saveNewPassword}
                          </Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                ))}

                </View>
            </>
          )}

          {role === 'owner' && restaurantWebsite ? (
            <>
              <Text style={styles.groupLabel}>Product Management</Text>
              <View style={styles.section}>
                <TouchableOpacity
                  style={[styles.row, { borderBottomWidth: openSection === 'products' ? 1 : 0 }]}
                  onPress={() => {
                    toggleSection('products');
                    if (openSection !== 'products' && products.length === 0) loadProducts();
                  }}
                >
                  <Ionicons name="fast-food-outline" size={18} color="#999" />
                  <Text style={[styles.rowValue, { flex: 1 }]}>Manage Products</Text>
                  {productsLoading && <Text style={{ color: '#999', fontSize: 13 }}>Loading...</Text>}
                  <Text style={styles.chevron}>{openSection === 'products' ? '▲' : '▼'}</Text>
                </TouchableOpacity>

                {openSection === 'products' && (() => {
                  const categories = [...new Set(products.map(p => p.category || 'Other'))];
                  return categories.map((cat, ci) => {
                    const catProducts = products.filter(p => (p.category || 'Other') === cat);
                    const isOpen = openCategory === cat;
                    const isLast = ci === categories.length - 1;
                    return (
                      <View key={cat}>
                        <TouchableOpacity
                          style={[styles.row, { borderBottomWidth: isOpen || !isLast ? 1 : 0 }]}
                          onPress={() => setOpenCategory(isOpen ? null : cat)}
                        >
                          <Ionicons name="folder-outline" size={16} color="#8B38CB" />
                          <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: '#111' }}>{cat}</Text>
                          <Text style={{ fontSize: 12, color: '#999', marginRight: 8 }}>{catProducts.length}</Text>
                          <Text style={styles.chevron}>{isOpen ? '▲' : '▼'}</Text>
                        </TouchableOpacity>
                        {isOpen && catProducts.map((product, i) => (
                          <View key={product.id} style={[styles.row, { paddingLeft: 32, borderBottomWidth: i === catProducts.length - 1 && isLast ? 0 : 1 }]}>
                            <View style={{ flex: 1 }}>
                              <Text style={{ fontSize: 14, color: product.enabled ? '#111' : '#999', fontWeight: '500' }}>{product.name}</Text>
                              {product.price ? <Text style={{ fontSize: 12, color: '#999', marginTop: 2 }}>CHF {product.price}</Text> : null}
                            </View>
                            <TouchableOpacity
                              onPress={() => toggleProduct(product.id, !product.enabled)}
                              disabled={togglingProduct === product.id}
                              style={{
                                width: 50, height: 28, borderRadius: 14,
                                backgroundColor: togglingProduct === product.id ? '#ccc' : product.enabled ? '#2ecc71' : '#ddd',
                                justifyContent: 'center', paddingHorizontal: 2,
                              }}
                            >
                              <View style={{
                                width: 24, height: 24, borderRadius: 12, backgroundColor: '#fff',
                                alignSelf: product.enabled ? 'flex-end' : 'flex-start',
                                shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 2, elevation: 2,
                              }} />
                            </TouchableOpacity>
                          </View>
                        ))}
                      </View>
                    );
                  });
                })()}
              </View>
            </>
          ) : null}

          {role === 'owner' && (
            <>
              <Text style={styles.groupLabel}>{t.notificationSound}</Text>

              <View style={styles.section}>
                <TouchableOpacity
                  style={[styles.row, { borderBottomWidth: openSection === 'sound' ? 1 : 0 }]}
                  onPress={() => { toggleSection('sound'); if (openSection === 'sound') stopPreviewSound(); }}
                >
                  <Ionicons name="musical-notes-outline" size={18} color="#999" />
                  <Text style={[styles.rowValue, { flex: 1 }]}>{currentSoundLabel}</Text>
                  <Text style={styles.chevron}>{openSection === 'sound' ? '▲' : '▼'}</Text>
                </TouchableOpacity>

                {openSection === 'sound' && SOUNDS.map((sound, i) => (
                  <TouchableOpacity
                    key={sound.key}
                    style={[styles.row, i === SOUNDS.length - 1 && { borderBottomWidth: 0 }]}
                    onPress={async () => {
                      setNotificationSound(sound.key);
                      await AsyncStorage.setItem('notification_sound', sound.key);
                      await previewSound(sound.key);
                    }}
                  >
                    <Ionicons name={sound.icon as any} size={18} color="#999" />

                    <Text
                      style={[
                        styles.rowValue,
                        { flex: 1 },
                        notificationSound === sound.key && { fontWeight: '700', color: '#8B38CB' },
                      ]}
                    >
                      {sound.label}
                    </Text>

                    {notificationSound === sound.key && (
                      <Ionicons name="checkmark" size={18} color="#2ecc71" />
                    )}
                  </TouchableOpacity>
                ))}
              </View>
            </>
          )}

          {role === 'owner' && (
            <>
              <Text style={styles.groupLabel}>{t.restaurantProfile}</Text>

              <View style={styles.section}>
                <TouchableOpacity
                  style={[styles.row, { borderBottomWidth: openSection === 'restaurantForm' ? 1 : 0 }]}
                  onPress={() => toggleSection('restaurantForm')}
                >
                  <Ionicons name="storefront-outline" size={18} color="#999" />

                  <Text style={[styles.rowValue, { flex: 1 }]}>
                    {restaurantName || t.setUpProfile}
                  </Text>

                  {profileSuccess ? (
                    <Text style={{ color: '#2ecc71', fontSize: 13 }}>{profileSuccess}</Text>
                  ) : null}

                  <Text style={styles.chevron}>{openSection === 'restaurantForm' ? '▲' : '▼'}</Text>
                </TouchableOpacity>

                {openSection === 'restaurantForm' && (
                  <>
                    <TextInput
                      style={styles.input}
                      placeholder={t.restaurantName}
                      placeholderTextColor={Platform.OS === 'ios' ? '#ADADAD' : '#C0C0C0'}
                      value={restaurantName}
                      onChangeText={setRestaurantName}
                    />

                    <TextInput
                      style={[styles.input, { marginTop: 10 }]}
                      placeholder={t.phone}
                      placeholderTextColor={Platform.OS === 'ios' ? '#ADADAD' : '#C0C0C0'}
                      value={restaurantPhone}
                      onChangeText={setRestaurantPhone}
                      keyboardType="phone-pad"
                    />

                    <TextInput
                      style={[styles.input, { marginTop: 10 }]}
                      placeholder={t.address}
                      placeholderTextColor={Platform.OS === 'ios' ? '#ADADAD' : '#C0C0C0'}
                      value={restaurantAddress}
                      onChangeText={setRestaurantAddress}
                    />

                    <View style={[styles.input, { marginTop: 10, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: '#F0F0F0' }]}>
                      <Ionicons name="lock-closed-outline" size={14} color="#999" />
                      <Text style={{ fontSize: 15, color: restaurantWebsite ? '#111' : '#999' }}>
                        {restaurantWebsite || t.website}
                      </Text>
                    </View>

                    {profileError ? <Text style={styles.error}>{profileError}</Text> : null}

                    <TouchableOpacity
                      style={styles.primaryBtn}
                      onPress={handleSaveRestaurantProfile}
                      disabled={profileLoading}
                    >
                      <Text style={styles.primaryBtnText}>
                        {profileLoading ? t.saving : t.saveProfile}
                      </Text>
                    </TouchableOpacity>
                  </>
                )}
              </View>
            </>
          )}

          <Text style={styles.groupLabel}>{t.about}</Text>

          <View style={styles.section}>
            <TouchableOpacity
              style={[styles.row, { borderBottomWidth: openSection === 'about' ? 1 : 0 }]}
              onPress={() => toggleSection('about')}
            >
              <Image
                source={require('../../assets/images/foodup-icon.png')}
                style={styles.aboutIcon}
                resizeMode="contain"
              />
              <Text style={[styles.rowValue, { flex: 1 }]}>FoodUp</Text>
              <Text style={styles.chevron}>{openSection === 'about' ? '▲' : '▼'}</Text>
            </TouchableOpacity>

            {openSection === 'about' && (
              <>
                <Text style={styles.aboutTagline}>Online-Bestellsystem für Restaurants</Text>

                <TouchableOpacity style={styles.row} onPress={() => Linking.openURL('https://www.foodup.ch')}>
                  <Ionicons name="globe-outline" size={18} color="#999" />
                  <Text style={styles.rowValue}>www.foodup.ch</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.row} onPress={() => Linking.openURL('mailto:info@foodup.ch')}>
                  <Ionicons name="mail-outline" size={18} color="#999" />
                  <Text style={styles.rowValue}>info@foodup.ch</Text>
                </TouchableOpacity>

                <TouchableOpacity style={styles.row} onPress={() => Linking.openURL('https://wa.me/41783222292')}>
                  <Ionicons name="logo-whatsapp" size={18} color="#999" />
                  <Text style={styles.rowValue}>+41 78 322 22 92</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.row, { borderBottomWidth: 0 }]}
                  onPress={() => Linking.openURL('tel:+41432295051')}
                >
                  <Ionicons name="call-outline" size={18} color="#999" />
                  <Text style={styles.rowValue}>+41 43 229 50 51</Text>
                </TouchableOpacity>
              </>
            )}
          </View>

          <Text style={styles.groupLabel}>{t.language}</Text>

          <View style={styles.section}>
            <TouchableOpacity
              style={[styles.row, { borderBottomWidth: openSection === 'language' ? 1 : 0 }]}
              onPress={() => toggleSection('language')}
            >
              <Text style={styles.flagText}>{language === 'de' ? '🇩🇪' : '🇬🇧'}</Text>
              <Text style={[styles.rowValue, { flex: 1 }]}>
                {language === 'de' ? 'Deutsch' : 'English'}
              </Text>
              <Text style={styles.chevron}>{openSection === 'language' ? '▲' : '▼'}</Text>
            </TouchableOpacity>

            {openSection === 'language' && (
              <>
                <TouchableOpacity
                  style={[styles.row, { borderBottomWidth: 1 }]}
                  onPress={async () => {
                    setChangingLanguage(true);
                    await changeLanguage('en');
                    setChangingLanguage(false);
                    setShowLanguage(false);
                  }}
                >
                  <Text style={styles.flagText}>🇬🇧</Text>
                  <Text style={[styles.rowValue, { flex: 1 }, language === 'en' && { fontWeight: '700' }]}>
                    English
                  </Text>
                  {language === 'en' && !changingLanguage && (
                    <Ionicons name="checkmark" size={18} color="#2ecc71" />
                  )}
                  {changingLanguage && language !== 'en' && (
                    <Ionicons name="sync-outline" size={18} color="#999" />
                  )}
                </TouchableOpacity>

                <TouchableOpacity
                  style={[styles.row, { borderBottomWidth: 0 }]}
                  onPress={async () => {
                    setChangingLanguage(true);
                    await changeLanguage('de');
                    setChangingLanguage(false);
                    setShowLanguage(false);
                  }}
                >
                  <Text style={styles.flagText}>🇩🇪</Text>
                  <Text style={[styles.rowValue, { flex: 1 }, language === 'de' && { fontWeight: '700' }]}>
                    Deutsch
                  </Text>
                  {language === 'de' && !changingLanguage && (
                    <Ionicons name="checkmark" size={18} color="#2ecc71" />
                  )}
                  {changingLanguage && language !== 'de' && (
                    <Ionicons name="sync-outline" size={18} color="#999" />
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>

{role === 'owner' && (
            <>
              <Text style={styles.groupLabel}>Acceptance Times</Text>
              <View style={styles.section}>
                <TouchableOpacity
                  style={[styles.row, { borderBottomWidth: openSection === 'acceptanceTimes' ? 1 : 0 }]}
                  onPress={() => toggleSection('acceptanceTimes')}
                >
                  <Ionicons name="time-outline" size={18} color="#999" />
                  <Text style={[styles.rowValue, { flex: 1 }]}>Acceptance Times</Text>
                  <Text style={styles.chevron}>{openSection === 'acceptanceTimes' ? '▲' : '▼'}</Text>
                </TouchableOpacity>
                {openSection === 'acceptanceTimes' && <View style={{ paddingVertical: 14 }}>
                  <Text style={{ fontSize: 14, color: '#666', marginBottom: 12 }}>
                    Set the time options shown when accepting orders
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
                    {acceptanceTimes.map((time, i) => (
                      <View key={i} style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: '#F5F5F5', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, gap: 8 }}>
                        <Text style={{ fontSize: 14, fontWeight: '600', color: '#111' }}>{time} min</Text>
                        <TouchableOpacity onPress={async () => {
                          const updated = acceptanceTimes.filter((_, idx) => idx !== i);
                          setAcceptanceTimes(updated);
                          const pin = await getPin();
                          const code = await AsyncStorage.getItem('restaurant_code') || '';
                          try {
                            await fetch(`${BACKEND_URL}/acceptance-times`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ restaurant_code: code, owner_pin: pin, times: updated }),
                            });
                          } catch (e) {}
                        }}>
                          <Ionicons name="close-circle" size={16} color="#999" />
                        </TouchableOpacity>
                      </View>
                    ))}
                  </View>
                  <View style={{ flexDirection: 'row', gap: 10 }}>
                    <TextInput
                      style={[styles.input, { flex: 1, marginTop: 0 }]}
                      placeholder="Add time (e.g. 20)"
                      placeholderTextColor={Platform.OS === 'ios' ? '#ADADAD' : '#C0C0C0'}
                      keyboardType="numeric"
                      value={newAcceptanceTime}
                      onChangeText={setNewAcceptanceTime}
                    />
                    <TouchableOpacity
                      style={{ backgroundColor: '#111', borderRadius: 10, paddingHorizontal: 16, justifyContent: 'center' }}
                      onPress={async () => {
                        const num = parseInt(newAcceptanceTime);
                        if (!isNaN(num) && num > 0 && !acceptanceTimes.includes(num)) {
                          const updated = [...acceptanceTimes, num].sort((a, b) => a - b);
                          setAcceptanceTimes(updated);
                          setNewAcceptanceTime('');
                          const pin = await getPin();
                          const code = await AsyncStorage.getItem('restaurant_code') || '';
                          try {
                            await fetch(`${BACKEND_URL}/acceptance-times`, {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({ restaurant_code: code, owner_pin: pin, times: updated }),
                            });
                          } catch (e) {}
                        }
                      }}
                    >
                      <Text style={{ color: '#fff', fontWeight: '600' }}>Add</Text>
                    </TouchableOpacity>
                  </View>
                </View>}
              </View>
            <Text style={styles.groupLabel}>{t.dangerZone}</Text>
              <View style={styles.section}>
                <TouchableOpacity
                  onPress={async () => {
                    Alert.alert(
                      t.clearOrders,
                      t.clearOrdersConfirm,
                      [
                        { text: t.cancel, style: 'cancel' },
                        {
                          text: t.clear,
                          style: 'destructive',
                          onPress: async () => {
                            const pin = await getPin();
                            const code = await AsyncStorage.getItem('restaurant_code') || '';
                            try {
                              await fetch(`${BACKEND_URL}/clear-orders/${code}`, {
                                method: 'DELETE',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ owner_pin: pin }),
                              });
                              await AsyncStorage.removeItem('foodup_orders');
                              Alert.alert('Done', t.ordersCleared);
                            } catch (e) {
                              Alert.alert('Error', t.connectionError);
                            }
                          },
                        },
                      ]
                    );
                  }}
                  style={{ paddingVertical: 14, alignItems: 'center' }}
                >
                  <Text style={{ color: '#e74c3c', fontSize: 15, fontWeight: '500' }}>{t.clearOrders}</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {role === 'owner' && Platform.OS === 'android' && (
            <>
              <Text style={styles.groupLabel}>Printer</Text>
              <View style={styles.section}>
                <TouchableOpacity
                  onPress={checkPrinterPairing}
                  style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 14 }}
                  disabled={checkingPrinter}
                >
                  <Ionicons name="print-outline" size={18} color="#111" />
                  <Text style={{ fontSize: 15, fontWeight: '600', color: '#111' }}>
                    {checkingPrinter ? 'Checking...' : 'Check Printer Pairing'}
                  </Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          {Platform.OS === 'android' && deviceId ? (
            <Text style={{ textAlign: 'center', color: '#999', fontSize: 11, marginTop: 8 }}>
              Device ID: {deviceId}
            </Text>
          ) : null}
          <Text style={{ textAlign: 'center', color: '#999', fontSize: 11, marginTop: 4 }}>v1.0.0 — build bc20cba</Text>
          <Text style={styles.groupLabel}>{t.account}</Text>

          <View style={styles.section}>
            <TouchableOpacity
              onPress={handleLogout}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                paddingVertical: 14,
              }}
            >
              <Ionicons name="log-out-outline" size={18} color="#e74c3c" />
              <Text style={styles.logoutText}>{t.logOut}</Text>
            </TouchableOpacity>
          </View>
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
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
    alignItems: 'center',
  },
  logo: { width: 100, height: 30 },
  scrollContent: { paddingBottom: 40, paddingTop: 8 },
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
  section: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    borderRadius: 14,
    paddingHorizontal: 20,
    paddingVertical: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.04,
    shadowRadius: 4,
    elevation: 1,
  },
  profileName: { fontSize: 18, fontWeight: '700', color: '#111' },
  profileRole: { fontSize: 13, color: '#999', marginTop: 2 },
  input: {
    borderWidth: 1,
    borderColor: '#E8E8E8',
    borderRadius: 10,
    padding: 14,
    fontSize: 15,
    color: '#111',
    backgroundColor: '#FAFAFA',
    marginTop: 8,
  },
  error: { color: '#e74c3c', marginTop: 8, fontSize: 13 },
  successText: { color: '#2ecc71', marginTop: 8, fontSize: 13 },
  primaryBtn: {
    backgroundColor: '#111',
    borderRadius: 10,
    padding: 14,
    alignItems: 'center',
    marginTop: 12,
    marginBottom: 4,
  },
  primaryBtnText: { fontSize: 15, fontWeight: '600', color: '#fff' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  rowValue: { fontSize: 15, color: '#111' },
  deleteText: { fontSize: 14, color: '#e74c3c' },
  resetText: { fontSize: 14, color: '#007AFF' },
  dividerText: { fontSize: 14, color: '#ccc' },
  resetBox: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  resetInput: {
    borderWidth: 1,
    borderColor: '#E8E8E8',
    borderRadius: 10,
    padding: 12,
    fontSize: 15,
    color: '#111',
    backgroundColor: '#FAFAFA',
    marginBottom: 8,
  },
  chevron: { fontSize: 12, color: '#999', lineHeight: 20 },
  aboutTagline: { fontSize: 13, color: '#999', paddingVertical: 10 },
  aboutIcon: { width: 20, height: 20 },
  logoutText: { fontSize: 15, color: '#e74c3c', fontWeight: '500' },
  flagText: { fontSize: 20 },
});