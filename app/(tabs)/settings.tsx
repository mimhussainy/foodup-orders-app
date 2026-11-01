import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Audio } from 'expo-av';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert, Animated, Dimensions, Easing, Image, Keyboard, KeyboardAvoidingView, Linking, Modal, Platform,
  SafeAreaView, ScrollView,
  StyleSheet, Text, TextInput, TouchableOpacity, View
} from 'react-native';
import { useLanguage } from '../../lib/useLanguage';
import { clearStoredEdition, getEdition, useIsFree } from '../../lib/edition';
import { ProBadge } from '../../components/ProLocked';

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

// ---------------------------------------------------------------------------
// Small UI pieces used by the redesigned Settings screen
// ---------------------------------------------------------------------------
const PURPLE = '#8B38CB';
const LINE = '#ECE9F1';
const MUTED = '#6C6678';
const INK = '#17141F';
const SCREEN_H = Dimensions.get('window').height;

// Switch with a sliding knob.
function Toggle({
  on, onPress, disabled, passive, w = 46, h = 28, onColor = PURPLE, offColor = '#D9D5E0',
}: {
  on: boolean; onPress?: () => void; disabled?: boolean; passive?: boolean;
  w?: number; h?: number; onColor?: string; offColor?: string;
}) {
  const anim = useRef(new Animated.Value(on ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: on ? 1 : 0, duration: 250, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [on]);
  const k = h - 4;
  const track = (
    <View style={{ width: w, height: h, borderRadius: h / 2, padding: 2, backgroundColor: on ? onColor : offColor }}>
      <Animated.View
        style={{
          width: k, height: k, borderRadius: k / 2, backgroundColor: '#fff',
          shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2,
          transform: [{ translateX: anim.interpolate({ inputRange: [0, 1], outputRange: [0, w - h] }) }],
        }}
      />
    </View>
  );
  if (passive) return track;
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityState={{ checked: on, disabled: !!disabled }}
      style={{ opacity: disabled ? 0.6 : 1 }}
    >
      {track}
    </TouchableOpacity>
  );
}

// Segmented switch with a sliding thumb.
function SlideSwitch({
  options, value, onChange, width = 156, height = 32,
}: {
  options: { key: string; label: string }[]; value: string; onChange: (key: string) => void;
  width?: number; height?: number;
}) {
  const idx = Math.max(0, options.findIndex(o => o.key === value));
  const anim = useRef(new Animated.Value(idx)).current;
  useEffect(() => {
    Animated.timing(anim, { toValue: idx, duration: 300, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
  }, [idx]);
  const seg = (width - 6) / options.length;
  return (
    <View style={{ width, height, borderRadius: 9, backgroundColor: LINE, padding: 3, flexDirection: 'row' }}>
      <Animated.View
        pointerEvents="none"
        style={{
          position: 'absolute', left: 3, top: 3, width: seg, height: height - 6, borderRadius: 7, backgroundColor: '#fff',
          shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 2, shadowOffset: { width: 0, height: 1 }, elevation: 2,
          transform: [{ translateX: Animated.multiply(anim, seg) }],
        }}
      />
      {options.map(o => (
        <TouchableOpacity
          key={o.key}
          activeOpacity={0.8}
          onPress={() => onChange(o.key)}
          accessibilityRole="button"
          accessibilityState={{ selected: o.key === value }}
          style={{ width: seg, alignItems: 'center', justifyContent: 'center' }}
        >
          <Text style={{ fontSize: 12, fontWeight: o.key === value ? '700' : '500', color: o.key === value ? INK : MUTED }}>{o.label}</Text>
        </TouchableOpacity>
      ))}
    </View>
  );
}

function QuickTile({ icon, label, value, onPress }: { icon: any; label: string; value: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.qTile} onPress={onPress} activeOpacity={0.8}>
      <Ionicons name={icon} size={20} color={PURPLE} />
      <View style={{ alignItems: 'center', alignSelf: 'stretch' }}>
        <Text style={styles.qLabel} numberOfLines={1}>{label}</Text>
        <Text style={styles.qValue} numberOfLines={1}>{value}</Text>
      </View>
    </TouchableOpacity>
  );
}

function ManageRow({
  icon, title, value, onPress, last, right,
}: { icon: any; title: string; value?: string; onPress: () => void; last?: boolean; right?: any }) {
  return (
    <TouchableOpacity style={[styles.mRow, last && { borderBottomWidth: 0 }]} onPress={onPress} activeOpacity={0.7}>
      <View style={styles.mIcon}><Ionicons name={icon} size={16} color={PURPLE} /></View>
      <Text style={styles.mTitle} numberOfLines={1}>{title}</Text>
      {value ? <Text style={styles.mValue} numberOfLines={1}>{value}</Text> : null}
      {right}
      <Ionicons name="chevron-forward" size={16} color="#B9B3C6" />
    </TouchableOpacity>
  );
}

export default function SettingsScreen() {
  const router = useRouter();
  const { language, t, changeLanguage } = useLanguage();
  // FoodUp Free: courier management is a Pro feature (no courier requests).
  const isFree = useIsFree();

  const SOUNDS = [
    { key: 'default', label: t.default, icon: 'notifications-outline' },
    { key: 'data_scanner', label: t.dataScanner, icon: 'scan-outline' },
    { key: 'security_alarm', label: t.securityAlarm, icon: 'shield-outline' },
    { key: 'classic_alarm', label: t.classicAlarm, icon: 'alarm-outline' },
    { key: 'slot_machine', label: t.slotMachine, icon: 'musical-notes-outline' },
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
    if (getEdition() === 'free') return;
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
  // Pro was switched on while this screen was open: load the courier accounts now.
  const wasFreeRef = useRef(isFree);
  useEffect(() => {
    if (wasFreeRef.current && !isFree && role === 'owner') loadAccounts();
    wasFreeRef.current = isFree;
  }, [isFree]);

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
    await clearStoredEdition();

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

  // --- Redesign: bottom sheet + shared handlers (logic unchanged, moved out of the JSX) ---
  const [sheet, setSheet] = useState<string | null>(null);
  const [sheetMounted, setSheetMounted] = useState(false);
  const sheetAnim = useRef(new Animated.Value(0)).current;

  const openSheet = (key: string) => {
    setSheet(key);
    setSheetMounted(true);
    Animated.timing(sheetAnim, { toValue: 1, duration: 380, easing: Easing.out(Easing.cubic), useNativeDriver: true }).start();
    if (key === 'products' && products.length === 0) loadProducts();
  };

  const closeSheet = () => {
    Keyboard.dismiss();
    stopPreviewSound();
    Animated.timing(sheetAnim, { toValue: 0, duration: 260, easing: Easing.in(Easing.cubic), useNativeDriver: true }).start(({ finished }) => {
      if (finished) setSheetMounted(false);
    });
  };

  const toggleStore = async () => {
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
  };

  const setLang = async (code: 'en' | 'de') => {
    if (changingLanguage || language === code) return;
    setChangingLanguage(true);
    await AsyncStorage.multiSet([
      ['app_language', code],
      ['language', code],
    ]);
    await changeLanguage(code);
    setChangingLanguage(false);
  };

  const confirmClearOrders = () => {
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
  };

  const confirmLogout = () => {
    Alert.alert(t.logOut, undefined, [
      { text: t.cancel, style: 'cancel' },
      { text: t.logOut, style: 'destructive', onPress: handleLogout },
    ]);
  };

  const minTime = acceptanceTimes.length ? Math.min(...acceptanceTimes) : 0;
  const maxTime = acceptanceTimes.length ? Math.max(...acceptanceTimes) : 0;
  const timesValue = acceptanceTimes.length ? `${minTime}–${maxTime} min` : '–';
  const sheetTitles: { [key: string]: string } = {
    sound: t.notificationSound,
    times: t.acceptanceTimes,
    profile: t.restaurantProfile,
    products: t.manageProducts,
    couriers: t.courierAccounts,
    about: t.about,
    printer: t.printer,
  };

  const renderSheetContent = () => {
    if (sheet === 'sound') {
      return (
        <View style={styles.section}>
          {SOUNDS.map((sound, i) => (
            <TouchableOpacity
              key={sound.key}
              style={[styles.row, i === SOUNDS.length - 1 && { borderBottomWidth: 0 }]}
              onPress={async () => {
                setNotificationSound(sound.key);
                await AsyncStorage.setItem('notification_sound', sound.key);
                await previewSound(sound.key);
              }}
            >
              <View style={[styles.radio, notificationSound === sound.key && { borderColor: PURPLE }]}>
                {notificationSound === sound.key && <View style={styles.radioDot} />}
              </View>
              <Text style={[styles.rowValue, { flex: 1 }, notificationSound === sound.key && { fontWeight: '700' }]}>
                {sound.label}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
      );
    }

    if (sheet === 'times') {
      return (
        <View style={[styles.section, { paddingVertical: 18 }]}>
          <Text style={{ fontSize: 13, color: MUTED, marginBottom: 12 }}>{t.acceptanceTimesSub}</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {acceptanceTimes.map((time, i) => (
              <View key={i} style={styles.chip}>
                <Text style={{ fontSize: 13, fontWeight: '600', color: '#6B21A8' }}>{time} min</Text>
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
                  <Ionicons name="close" size={14} color="#6B21A8" />
                </TouchableOpacity>
              </View>
            ))}
          </View>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <TextInput
              style={[styles.input, { flex: 1, marginTop: 0 }]}
              placeholder={t.addTimePlaceholder}
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
              <Text style={{ color: '#fff', fontWeight: '600' }}>{t.add}</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    if (sheet === 'profile') {
      return (
        <View style={[styles.section, { paddingTop: 14, paddingBottom: 20 }]}>
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
          {profileSuccess ? <Text style={styles.successText}>{profileSuccess}</Text> : null}
          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: profileSuccess ? '#1E7B45' : PURPLE, marginTop: 16 }]}
            onPress={handleSaveRestaurantProfile}
            disabled={profileLoading}
          >
            <Text style={styles.primaryBtnText}>{profileLoading ? t.saving : t.saveProfile}</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (sheet === 'products') {
      const categories = [...new Set(products.map(p => p.category || t.otherCategory))];
      return (
        <View style={styles.section}>
          {productsLoading && <Text style={{ color: '#999', fontSize: 13, paddingVertical: 14 }}>{t.loading}</Text>}
          {categories.map((cat, ci) => {
            const catProducts = products.filter(p => (p.category || 'Other') === cat);
            const isOpen = openCategory === cat;
            const isLast = ci === categories.length - 1;
            return (
              <View key={cat}>
                <TouchableOpacity
                  style={[styles.row, { borderBottomWidth: isOpen || !isLast ? 1 : 0 }]}
                  onPress={() => setOpenCategory(isOpen ? null : cat)}
                >
                  <Ionicons name="folder-outline" size={16} color={PURPLE} />
                  <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: '#111' }}>{cat}</Text>
                  <Text style={{ fontSize: 12, color: '#999', marginRight: 8 }}>{catProducts.length}</Text>
                  <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={14} color="#999" />
                </TouchableOpacity>
                {isOpen && catProducts.map((product, i) => (
                  <View key={product.id} style={[styles.row, { paddingLeft: 32, borderBottomWidth: i === catProducts.length - 1 && isLast ? 0 : 1 }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 14, color: product.enabled ? '#111' : '#999', fontWeight: '500' }}>{product.name}</Text>
                      {product.price ? <Text style={{ fontSize: 12, color: '#999', marginTop: 2 }}>CHF {product.price}</Text> : null}
                    </View>
                    <Toggle
                      on={!!product.enabled}
                      onPress={() => toggleProduct(product.id, !product.enabled)}
                      disabled={togglingProduct === product.id}
                      w={42}
                      h={24}
                    />
                  </View>
                ))}
              </View>
            );
          })}
        </View>
      );
    }

    if (sheet === 'couriers') {
      if (isFree) {
        return (
          <View style={[styles.section, { paddingVertical: 18 }]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <Text style={{ flex: 1, fontSize: 15, fontWeight: '600', color: '#111' }}>{t.courierAccounts}</Text>
              <ProBadge label={t.proBadge} />
            </View>
            <Text style={{ fontSize: 13, color: MUTED, lineHeight: 19 }}>{t.proCouriersText} {t.proUpgradeHint}</Text>
          </View>
        );
      }
      return (
        <>
          {accounts.length > 0 && (
            <>
              <Text style={[styles.groupLabel, { marginTop: 4 }]}>{accounts.length} {t.courierAccounts}</Text>
              <View style={styles.section}>
                {accounts.map((account, i, arr) => (
                  <View key={i}>
                    <View style={[styles.row, i === arr.length - 1 && !resetTarget && { borderBottomWidth: 0 }]}>
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
                          <Text style={{ fontSize: 12, color: '#e74c3c', marginTop: 2 }}>{t.noPhoneSet}</Text>
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
                          <Text style={styles.primaryBtnText}>{resetLoading ? t.saving : t.saveNewPassword}</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                ))}
              </View>
            </>
          )}

          <Text style={styles.groupLabel}>{t.addCourierAccount}</Text>
          <View style={[styles.section, { paddingTop: 14, paddingBottom: 20 }]}>
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
            <TouchableOpacity style={[styles.primaryBtn, { marginTop: 16 }]} onPress={handleAddAccount} disabled={loading}>
              <Text style={styles.primaryBtnText}>{loading ? t.adding : t.addAccount}</Text>
            </TouchableOpacity>
          </View>
        </>
      );
    }

    if (sheet === 'about') {
      return (
        <View style={styles.section}>
          <View style={[styles.row, { paddingVertical: 16 }]}>
            <Image source={require('../../assets/images/foodup-icon.png')} style={styles.aboutIcon} resizeMode="contain" />
            <Text style={[styles.rowValue, { flex: 1, fontWeight: '600' }]}>FoodUp</Text>
          </View>
          <Text style={[styles.aboutTagline, { borderBottomWidth: 1, borderBottomColor: '#F0F0F0' }]}>{t.aboutTagline}</Text>
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
          <TouchableOpacity style={[styles.row, { borderBottomWidth: 0 }]} onPress={() => Linking.openURL('tel:+41432295051')}>
            <Ionicons name="call-outline" size={18} color="#999" />
            <Text style={styles.rowValue}>+41 43 229 50 51</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (sheet === 'printer') {
      return (
        <View style={styles.section}>
          <View style={styles.row}>
            <Text style={[styles.rowValue, { flex: 1 }]}>{t.deviceId}</Text>
            <Text style={{ fontSize: 12, color: MUTED }}>{deviceId || '–'}</Text>
          </View>
          <TouchableOpacity
            onPress={checkPrinterPairing}
            disabled={checkingPrinter}
            style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingVertical: 16 }}
          >
            <Ionicons name="print-outline" size={18} color={PURPLE} />
            <Text style={{ fontSize: 15, fontWeight: '600', color: PURPLE }}>
              {checkingPrinter ? t.checking : t.checkPrinterPairing}
            </Text>
          </TouchableOpacity>
        </View>
      );
    }

    return null;
  };

  const initial = (restaurantName || 'F').trim().charAt(0).toUpperCase();

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

          {role === 'owner' && (
            <View style={{ marginHorizontal: 16, marginTop: 10, gap: 18 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4 }}>
                <View style={styles.avatar}><Text style={styles.avatarText}>{initial}</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={{ fontSize: 15, fontWeight: '700', color: INK }} numberOfLines={1}>{restaurantName || t.setUpProfile}</Text>
                  <Text style={{ fontSize: 11, color: MUTED, marginTop: 2 }} numberOfLines={1}>{restaurantCode}</Text>
                </View>
              </View>

              {storeIsOpen !== null && (
                <TouchableOpacity
                  activeOpacity={0.9}
                  onPress={toggleStore}
                  disabled={storeLoading}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: !!storeIsOpen }}
                  style={[styles.hero, storeIsOpen ? styles.heroOn : styles.heroOff, storeLoading && { opacity: 0.7 }]}
                >
                  <Ionicons name="storefront-outline" size={22} color={storeIsOpen ? '#fff' : PURPLE} />
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 11, color: storeIsOpen ? 'rgba(255,255,255,0.8)' : MUTED }}>{t.storeStatus}</Text>
                    <Text style={{ fontSize: 16, fontWeight: '700', color: storeIsOpen ? '#fff' : INK, marginTop: 2 }}>
                      {storeIsOpen ? t.storeOpen : t.storeClosed}
                    </Text>
                    <Text style={{ fontSize: 11, color: storeIsOpen ? 'rgba(255,255,255,0.8)' : MUTED, marginTop: 2 }}>
                      {storeIsOpen ? t.storeOpenSub : t.storeClosedSub}
                    </Text>
                  </View>
                  <Toggle passive on={!!storeIsOpen} onColor="rgba(255,255,255,0.35)" />
                </TouchableOpacity>
              )}

              <View style={{ flexDirection: 'row', gap: 10 }}>
                <QuickTile icon="musical-notes-outline" label={t.notificationSound} value={currentSoundLabel} onPress={() => openSheet('sound')} />
                {Platform.OS === 'android' && (
                  <QuickTile
                    icon="print-outline"
                    label={t.printer}
                    value={checkingPrinter ? t.checking : (deviceId ? deviceId.slice(-6) : '–')}
                    onPress={() => openSheet('printer')}
                  />
                )}
                <QuickTile icon="time-outline" label={t.acceptanceTimes} value={timesValue} onPress={() => openSheet('times')} />
              </View>
            </View>
          )}

          <View style={{ marginHorizontal: 16, marginTop: 18 }}>
            <View style={[styles.section, { marginHorizontal: 0, paddingVertical: 12 }]}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <Text style={[styles.rowValue, { flex: 1, fontWeight: '600' }]}>{t.language}</Text>
                <SlideSwitch
                  options={[{ key: 'en', label: 'English' }, { key: 'de', label: 'Deutsch' }]}
                  value={language}
                  onChange={(k) => setLang(k as 'en' | 'de')}
                />
              </View>
            </View>
          </View>

          <View style={{ marginHorizontal: 16 }}>
            <Text style={[styles.groupLabel, { marginHorizontal: 4, marginTop: 18 }]}>{role === 'owner' ? t.restaurant : t.about}</Text>
            <View style={[styles.section, { marginHorizontal: 0 }]}>
              {role === 'owner' && (
                <ManageRow icon="person-outline" title={t.restaurantProfile} value={restaurantName} onPress={() => openSheet('profile')} />
              )}
              {role === 'owner' && restaurantWebsite ? (
                <ManageRow icon="fast-food-outline" title={t.manageProducts} onPress={() => openSheet('products')} />
              ) : null}
              {role === 'owner' && (
                <ManageRow
                  icon="bicycle-outline"
                  title={t.courierAccounts}
                  value={!isFree && accounts.length > 0 ? String(accounts.length) : undefined}
                  right={isFree ? <ProBadge label={t.proBadge} /> : undefined}
                  onPress={() => openSheet('couriers')}
                />
              )}
              <ManageRow icon="information-circle-outline" title="FoodUp" onPress={() => openSheet('about')} last />
            </View>
          </View>

          <View style={{ marginHorizontal: 16, marginTop: 18, flexDirection: 'row', gap: 12 }}>
            {role === 'owner' && (
              <TouchableOpacity style={[styles.dangerBtn, { backgroundColor: '#FBE9E7' }]} onPress={confirmClearOrders} activeOpacity={0.8}>
                <Ionicons name="trash-outline" size={16} color="#B3261E" />
                <Text style={{ fontSize: 13, fontWeight: '700', color: '#B3261E' }}>{t.clearOrders}</Text>
              </TouchableOpacity>
            )}
            <TouchableOpacity style={[styles.dangerBtn, { backgroundColor: INK }]} onPress={confirmLogout} activeOpacity={0.8}>
              <Ionicons name="log-out-outline" size={16} color="#fff" />
              <Text style={{ fontSize: 13, fontWeight: '700', color: '#fff' }}>{t.logOut}</Text>
            </TouchableOpacity>
          </View>

          {Platform.OS === 'android' && deviceId ? (
            <Text style={{ textAlign: 'center', color: '#999', fontSize: 11, marginTop: 20 }}>
              {t.deviceId}: {deviceId}
            </Text>
          ) : null}
          <Text style={{ textAlign: 'center', color: '#999', fontSize: 11, marginTop: 4 }}>v1.0.0 — build bc20cba</Text>
        </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>

      <Modal visible={sheetMounted} transparent animationType="none" onRequestClose={closeSheet} statusBarTranslucent>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Animated.View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(23,20,31,0.38)', opacity: sheetAnim }]}>
            <TouchableOpacity style={{ flex: 1 }} activeOpacity={1} onPress={closeSheet} accessibilityLabel="Close" />
          </Animated.View>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <Animated.View
              style={[
                styles.sheet,
                { transform: [{ translateY: sheetAnim.interpolate({ inputRange: [0, 1], outputRange: [SCREEN_H, 0] }) }] },
              ]}
            >
              <View style={styles.sheetHandle} />
              <View style={styles.sheetHeader}>
                <Text style={{ flex: 1, fontSize: 16, fontWeight: '700', color: INK }}>{sheet ? sheetTitles[sheet] : ''}</Text>
                <TouchableOpacity onPress={closeSheet} style={styles.sheetClose} accessibilityLabel="Close">
                  <Ionicons name="close" size={16} color={MUTED} />
                </TouchableOpacity>
              </View>
              <ScrollView
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 40, paddingTop: 4 }}
                style={{ maxHeight: SCREEN_H * 0.78 }}
              >
                {renderSheetContent()}
              </ScrollView>
            </Animated.View>
          </KeyboardAvoidingView>
        </View>
      </Modal>
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
  avatar: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#F3EAFB', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 16, fontWeight: '700', color: PURPLE },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 76, borderRadius: 16, paddingHorizontal: 20, paddingVertical: 12 },
  heroOn: { backgroundColor: PURPLE, shadowColor: PURPLE, shadowOpacity: 0.35, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 4 },
  heroOff: { backgroundColor: '#fff', borderWidth: 1, borderColor: LINE },
  qTile: {
    flex: 1, height: 88, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: '#fff', borderWidth: 1, borderColor: LINE,
  },
  qLabel: { fontSize: 11, color: MUTED, textAlign: 'center' },
  qValue: { fontSize: 12, fontWeight: '700', color: INK, marginTop: 2, textAlign: 'center' },
  mRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: LINE },
  mIcon: { width: 30, height: 30, borderRadius: 9, backgroundColor: '#F3EAFB', alignItems: 'center', justifyContent: 'center' },
  mTitle: { flex: 1, fontSize: 14, fontWeight: '600', color: INK },
  mValue: { fontSize: 12, color: MUTED, maxWidth: 130 },
  dangerBtn: { flex: 1, height: 44, borderRadius: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  sheet: { backgroundColor: '#F6F5F8', borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingTop: 10 },
  sheetHandle: { width: 36, height: 4, borderRadius: 2, backgroundColor: '#DAD5E3', alignSelf: 'center', marginBottom: 12 },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 20, paddingBottom: 12 },
  sheetClose: { width: 28, height: 28, borderRadius: 14, backgroundColor: LINE, alignItems: 'center', justifyContent: 'center' },
  radio: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, borderColor: '#B9B3C6', alignItems: 'center', justifyContent: 'center' },
  radioDot: { width: 9, height: 9, borderRadius: 5, backgroundColor: PURPLE },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 8, height: 32, paddingHorizontal: 12, borderRadius: 16, backgroundColor: '#F3EAFB' },
});
