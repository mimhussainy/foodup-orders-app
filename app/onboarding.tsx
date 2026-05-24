import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  Image,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useLanguage } from '../lib/useLanguage';

const BACKEND_URL = 'https://foodup-order-alerts-backend.onrender.com';

export default function OnboardingScreen() {
  const router = useRouter();
  const { t } = useLanguage();
  const [step, setStep] = useState<'restaurant' | 'pin'>('restaurant');
  const [restaurantCode, setRestaurantCode] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    AsyncStorage.multiGet(['restaurant_code', 'user_role', 'owner_pin']).then(([codeEntry, roleEntry, pinEntry]) => {
      if (codeEntry[1] && roleEntry[1] === 'owner' && pinEntry[1]) {
        router.replace('/(tabs)');
      } else if (codeEntry[1]) {
        setStep('pin');
      }
    });
  }, []);

  const handleRestaurantSubmit = async () => {
    if (!restaurantCode.trim()) { setError('Please enter your restaurant code'); return; }
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${BACKEND_URL}/verify-restaurant`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restaurant_code: restaurantCode.trim().toLowerCase() }),
      });
      const result = await response.json();
      if (result.success) {
        const oldCode = await AsyncStorage.getItem('restaurant_code') || '';
        const newCode = restaurantCode.trim().toLowerCase();
        if (oldCode && oldCode !== newCode) {
          try {
            const { default: Notifications } = require('expo-notifications');
            const tokenData = await Notifications.getExpoPushTokenAsync({
              projectId: 'a057b1fa-8571-453c-a989-a4de0c33949a',
            });
            const token = tokenData.data;
            if (token) {
              await fetch(`${BACKEND_URL}/unregister-token`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ token, restaurant_code: oldCode }),
              });
            }
          } catch (e) {}
        }
        await AsyncStorage.setItem('restaurant_code', newCode);
        setStep('pin');
      } else {
        setError('Restaurant not found. Please check your code.');
      }
    } catch (e) {
      setError(t.connectionError);
    }
    setLoading(false);
  };

  const handlePinSubmit = async () => {
    if (pin.length < 4) { setError(t.enterPinError); return; }
    setLoading(true);
    try {
      const code = await AsyncStorage.getItem('restaurant_code') || '';
      const endpoint = Platform.OS === 'ios' ? '/verify-ios-pin' : '/verify-pin';
      const body = Platform.OS === 'ios'
        ? { ios_pin: pin, restaurant_code: code }
        : { pin, restaurant_code: code };
      const response = await fetch(`${BACKEND_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (result.success) {
        await AsyncStorage.setItem('user_role', 'owner');
        await AsyncStorage.setItem('owner_pin', pin);
        if (Platform.OS === 'ios') {
          await AsyncStorage.setItem('ios_pin', pin);
        }
        router.replace('/(tabs)');
      } else {
        setError(t.incorrectPin);
        setPin('');
      }
    } catch (e) {
      setError(t.connectionError);
    }
    setLoading(false);
  };

  const goBack = () => {
    setStep('restaurant');
    setError('');
    setPin('');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        {step === 'pin' ? (
          <TouchableOpacity onPress={goBack} style={styles.backCircle}>
            <Ionicons name="chevron-back" size={20} color="#111" />
          </TouchableOpacity>
        ) : (
          <View style={styles.backCirclePlaceholder} />
        )}
        <Image source={require('../assets/images/logo.png')} style={styles.logo} resizeMode="contain" />
        <View style={styles.backCirclePlaceholder} />
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={styles.inner}>

        {step === 'restaurant' && (
          <View style={styles.section}>
            <Text style={styles.title}>Welcome to FoodUp!</Text>
            <Text style={styles.subtitle}>Enter your restaurant code to get started</Text>
            <TextInput
              style={styles.input}
              placeholder="Restaurant Code"
              placeholderTextColor={Platform.OS === 'ios' ? '#ADADAD' : '#C0C0C0'}
              value={restaurantCode}
              onChangeText={setRestaurantCode}
              autoCapitalize="none"
              autoFocus
              autoCorrect={false}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <TouchableOpacity style={styles.submitBtn} onPress={handleRestaurantSubmit} disabled={loading}>
              <Text style={styles.submitBtnText}>{loading ? 'Checking...' : t.continue}</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === 'pin' && (
          <View style={styles.section}>
            <Text style={styles.title}>{t.ownerLogin}</Text>
            <Text style={styles.subtitle}>{t.enterPin}</Text>
            <TextInput
              style={styles.input}
              placeholder={t.pin}
              placeholderTextColor={Platform.OS === 'ios' ? '#ADADAD' : '#C0C0C0'}
              keyboardType="numeric"
              secureTextEntry
              maxLength={6}
              value={pin}
              onChangeText={setPin}
              autoFocus
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <TouchableOpacity style={styles.submitBtn} onPress={handlePinSubmit} disabled={loading}>
              <Text style={styles.submitBtnText}>{loading ? t.verifying : t.continue}</Text>
            </TouchableOpacity>
          </View>
        )}

      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12, paddingTop: Platform.OS === 'android' ? 40 : 12, borderBottomWidth: 1, borderBottomColor: '#F0F0F0', backgroundColor: '#fff' },
  logo: { width: 100, height: 30 },
  backCircle: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#F5F5F5', justifyContent: 'center', alignItems: 'center', paddingBottom: 0 },
  backCirclePlaceholder: { width: 36, height: 36 },
  backArrow: { fontSize: 24, color: '#111', textAlign: 'center', lineHeight: 24 },
  inner: { flex: 1, paddingHorizontal: 28, paddingTop: 36 },
  section: { flex: 1 },
  title: { fontSize: 28, fontWeight: '700', color: '#111', marginBottom: 6, letterSpacing: -0.5 },
  subtitle: { fontSize: 15, color: '#999', marginBottom: 36 },
  input: { borderWidth: 1, borderColor: '#E8E8E8', borderRadius: 12, padding: 16, fontSize: 18, color: '#111' },
  error: { color: '#e74c3c', marginTop: 10, fontSize: 14 },
  submitBtn: { backgroundColor: '#111', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 16 },
  submitBtnText: { fontSize: 16, fontWeight: '600', color: '#fff' },
});