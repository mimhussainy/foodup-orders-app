import AsyncStorage from '@react-native-async-storage/async-storage';
import { ReactNode, useEffect, useState } from 'react';
import { Image, Platform, StyleSheet, Text, View } from 'react-native';

// Orders tab header: restaurant logo with an open/closed ring, restaurant
// name and a small "FoodUp Orders" line. Name and logo come from the
// restaurant profile the app already uses (FoodUp Ordering -> Branding) and
// are cached on the device, so the header shows instantly on the next start.

const BACKEND_URL = 'https://foodup-order-alerts-backend.onrender.com';
const OPEN_COLOR = '#1F8A4C';
const CLOSED_COLOR = '#C0392B';
const UNKNOWN_COLOR = '#E3E3E3';

type Branding = { name: string; logoUrl: string };

function cacheKey(code: string) {
  return `foodup_header_branding_${code}`;
}

function initialsOf(name: string, code: string): string {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase();
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return String(code || '').slice(0, 2).toUpperCase();
}

function useRestaurantBranding() {
  const [code, setCode] = useState('');
  const [branding, setBranding] = useState<Branding>({ name: '', logoUrl: '' });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const storedCode = String((await AsyncStorage.getItem('restaurant_code').catch(() => null)) || '').toLowerCase().trim();
      if (cancelled || !storedCode) return;
      setCode(storedCode);

      try {
        const cached = await AsyncStorage.getItem(cacheKey(storedCode));
        if (cached && !cancelled) setBranding(JSON.parse(cached));
      } catch (_) {}

      try {
        const result = await fetch(`${BACKEND_URL}/restaurant-profile/${encodeURIComponent(storedCode)}`).then(r => r.json());
        const profile = result?.profile || {};
        const next: Branding = {
          name: String(profile.name || profile.restaurant_name || '').trim(),
          logoUrl: String(profile.email_logo_url || profile.main_logo_url || profile.print_logo_url || '').trim(),
        };
        if (cancelled || (!next.name && !next.logoUrl)) return;
        setBranding(next);
        AsyncStorage.setItem(cacheKey(storedCode), JSON.stringify(next)).catch(() => {});
      } catch (_) {
        // Offline or older profile: keep the cached branding / initials.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { code, ...branding };
}

export default function RestaurantHeader({ storeIsOpen, right }: { storeIsOpen: boolean | null; right?: ReactNode }) {
  const { code, name, logoUrl } = useRestaurantBranding();
  const [logoFailed, setLogoFailed] = useState(false);

  useEffect(() => { setLogoFailed(false); }, [logoUrl]);

  const ringColor = storeIsOpen === null ? UNKNOWN_COLOR : storeIsOpen ? OPEN_COLOR : CLOSED_COLOR;
  const showLogo = !!logoUrl && !logoFailed;
  const displayName = name || code.toUpperCase();

  return (
    <View style={styles.row}>
      <View style={styles.left}>
        <View style={[styles.ring, { borderColor: ringColor }]}>
          <View style={[styles.avatar, { backgroundColor: showLogo ? '#FFFFFF' : '#1F1F1F' }]}>
            {showLogo ? (
              <Image source={{ uri: logoUrl }} style={styles.logo} resizeMode="contain" onError={() => setLogoFailed(true)} />
            ) : (
              <Text style={styles.initials}>{initialsOf(name, code)}</Text>
            )}
          </View>
        </View>
        <View style={styles.texts}>
          <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
          <View style={styles.subline}>
            <Image source={require('../assets/images/foodup-icon.png')} style={styles.foodupIcon} resizeMode="contain" />
            <Text style={styles.sublineText}>FoodUp Orders</Text>
          </View>
        </View>
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

export const STORE_OPEN_COLOR = OPEN_COLOR;
export const STORE_CLOSED_COLOR = CLOSED_COLOR;

const styles = StyleSheet.create({
  row: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  left: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12 },
  ring: { width: 46, height: 46, borderRadius: 23, borderWidth: 2, padding: 2 },
  avatar: { flex: 1, borderRadius: 19, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  logo: { width: '82%', height: '82%' },
  initials: { color: '#FFFFFF', fontSize: 13, fontWeight: '800', letterSpacing: 0.5 },
  texts: { flex: 1, minWidth: 0, gap: 3 },
  name: { fontSize: Platform.OS === 'android' ? 16 : 17, fontWeight: '800', color: '#111111' },
  subline: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  foodupIcon: { width: 13, height: 13 },
  sublineText: { fontSize: 11, color: '#6B6B6B' },
  right: { flexShrink: 0 },
});
