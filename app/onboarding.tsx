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
  const [step, setStep] = useState<'restaurant' | 'role' | 'pin' | 'ios_pin' | 'delivery_login'>('restaurant');
  const [iosPin, setIosPin] = useState('');
  const [restaurantCode, setRestaurantCode] = useState('');

  useEffect(() => {
    AsyncStorage.getItem('restaurant_code').then(code => {
      if (code) setStep('role');
    });
  }, []);
  const [pin, setPin] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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
        await AsyncStorage.setItem('restaurant_code', restaurantCode.trim().toLowerCase());
        setStep('role');
      } else {
        setError('Restaurant not found. Please check your code.');
      }
    } catch (e) {
      setError(t.connectionError);
    }
    setLoading(false);
  };

  const handleRoleSelect = (selectedRole: 'owner' | 'delivery') => {
    setError('');
    if (selectedRole === 'owner') setStep('pin');
    else setStep('delivery_login');
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

  const handleIosPinSubmit = async () => {
    if (iosPin.length < 4) { setError(t.enterPinError); return; }
    setLoading(true);
    try {
      const code = await AsyncStorage.getItem('restaurant_code') || '';
      const response = await fetch(`${BACKEND_URL}/verify-ios-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ios_pin: iosPin, restaurant_code: code }),
      });
      const result = await response.json();
      if (result.success) {
        await AsyncStorage.setItem('user_role', 'owner');
        router.replace('/(tabs)');
      } else {
        setError(result.message || t.incorrectPin);
        setIosPin('');
      }
    } catch (e) {
      setError(t.connectionError);
    }
    setLoading(false);
  };

  const handleDeliveryLogin = async () => {
    if (!username.trim() || !password.trim()) { setError(t.enterCredentialsError); return; }
    setLoading(true);
    try {
      const code = await AsyncStorage.getItem('restaurant_code') || '';
      const response = await fetch(`${BACKEND_URL}/verify-delivery-account`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: username.trim(), password: password.trim(), restaurant_code: code }),
      });
      const result = await response.json();
      if (result.success) {
        const code = await AsyncStorage.getItem('restaurant_code') || '';
        await AsyncStorage.setItem('user_role', 'delivery');
        await AsyncStorage.setItem('delivery_name', result.username);
        await AsyncStorage.setItem('restaurant_code', code);
        router.replace('/(tabs)');
      } else {
        setError(t.invalidCredentials);
      }
    } catch (e) {
      setError(t.connectionError);
    }
    setLoading(false);
  };

  const goBack = () => {
    if (step === 'role') setStep('restaurant');
    else if (step === 'pin' || step === 'delivery_login') setStep('role');
    else if (step === 'ios_pin') { setStep('pin'); setIosPin(''); }
    setError('');
    setPin('');
    setUsername('');
    setPassword('');
  };

  const showBackButton = step !== 'restaurant';

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        {showBackButton ? (
          <TouchableOpacity onPress={goBack} style={styles.backCircle}>
            <Text style={styles.backArrow}>‹</Text>
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

        {step === 'role' && (
          <View style={styles.section}>
            <Text style={styles.title}>{t.welcome}</Text>
            <Text style={styles.subtitle}>{t.signIn}</Text>
            <TouchableOpacity style={styles.roleCard} onPress={() => handleRoleSelect('owner')}>
              <View>
                <Text style={styles.roleCardTitle}>{t.owner}</Text>
                <Text style={styles.roleCardSub}>{t.ownerSub}</Text>
              </View>
              <Text style={styles.roleCardArrow}>›</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.roleCard} onPress={() => handleRoleSelect('delivery')}>
              <View>
                <Text style={styles.roleCardTitle}>{t.courier}</Text>
                <Text style={styles.roleCardSub}>{t.courierSub}</Text>
              </View>
              <Text style={styles.roleCardArrow}>›</Text>
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

        {step === 'ios_pin' && (
          <View style={styles.section}>
            <Text style={styles.title}>iOS App PIN</Text>
            <Text style={styles.subtitle}>Enter your iOS app PIN to continue</Text>
            <TextInput
              style={styles.input}
              placeholder={t.pin}
              placeholderTextColor={Platform.OS === 'ios' ? '#ADADAD' : '#C0C0C0'}
              keyboardType="numeric"
              secureTextEntry
              maxLength={6}
              value={iosPin}
              onChangeText={setIosPin}
              autoFocus
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <TouchableOpacity style={styles.submitBtn} onPress={handleIosPinSubmit} disabled={loading}>
              <Text style={styles.submitBtnText}>{loading ? t.verifying : t.continue}</Text>
            </TouchableOpacity>
          </View>
        )}

        {step === 'delivery_login' && (
          <View style={styles.section}>
            <Text style={styles.title}>{t.courierLogin}</Text>
            <Text style={styles.subtitle}>{t.enterCredentials}</Text>
            <TextInput
              style={styles.input}
              placeholder={t.username}
              placeholderTextColor={Platform.OS === 'ios' ? '#ADADAD' : '#C0C0C0'}
              value={username}
              onChangeText={setUsername}
              autoFocus
              autoCapitalize="none"
            />
            <TextInput
              style={[styles.input, { marginTop: 12 }]}
              placeholder={t.password}
              placeholderTextColor={Platform.OS === 'ios' ? '#ADADAD' : '#C0C0C0'}
              secureTextEntry
              value={password}
              onChangeText={setPassword}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <TouchableOpacity style={styles.submitBtn} onPress={handleDeliveryLogin} disabled={loading}>
              <Text style={styles.submitBtnText}>{loading ? t.signingIn : t.continue}</Text>
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
  roleCard: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 18, paddingHorizontal: 20, borderRadius: 14, borderWidth: 1, borderColor: '#EFEFEF', marginBottom: 12, backgroundColor: '#FAFAFA' },
  roleCardTitle: { fontSize: 16, fontWeight: '600', color: '#111', marginBottom: 2 },
  roleCardSub: { fontSize: 13, color: '#999' },
  roleCardArrow: { fontSize: 24, color: '#C0C0C0' },
  input: { borderWidth: 1, borderColor: '#E8E8E8', borderRadius: 12, padding: 16, fontSize: 18, color: '#111' },
  error: { color: '#e74c3c', marginTop: 10, fontSize: 14 },
  submitBtn: { backgroundColor: '#111', borderRadius: 12, padding: 16, alignItems: 'center', marginTop: 16 },
  submitBtnText: { fontSize: 16, fontWeight: '600', color: '#fff' },
});