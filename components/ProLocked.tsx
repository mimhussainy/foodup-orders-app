import { Ionicons } from '@expo/vector-icons';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

// Full-screen "Available in FoodUp Pro" view for FoodUp Free restaurants.
// Purely local: makes no network requests.

const BRAND = '#8B38CB';

export function ProBadge({ label = 'Pro' }: { label?: string }) {
  return (
    <View style={styles.badge}>
      <Ionicons name="lock-closed" size={10} color={BRAND} />
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

export default function ProLocked({
  title,
  message,
  hint,
  icon = 'bar-chart-outline',
}: {
  title: string;
  message: string;
  hint: string;
  icon?: string;
}) {
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <View style={styles.card}>
        <View style={styles.iconWrap}>
          <Ionicons name={icon as any} size={30} color={BRAND} />
          <View style={styles.lockDot}>
            <Ionicons name="lock-closed" size={12} color="#fff" />
          </View>
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.message}>{message}</Text>
        <Text style={styles.hint}>{hint}</Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F7F7FA', justifyContent: 'center', paddingHorizontal: 24 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 20,
    paddingVertical: 32,
    paddingHorizontal: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#ECECF2',
  },
  iconWrap: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#F3E8FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  lockDot: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: BRAND,
    borderWidth: 2,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: Platform.OS === 'android' ? 17 : 19, fontWeight: '700', color: '#111', textAlign: 'center', marginBottom: 8 },
  message: { fontSize: Platform.OS === 'android' ? 13 : 15, color: '#555', textAlign: 'center', lineHeight: 20, marginBottom: 12 },
  hint: { fontSize: Platform.OS === 'android' ? 12 : 13, color: '#999', textAlign: 'center' },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 6,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#F3E8FF',
  },
  badgeText: { fontSize: 10, fontWeight: '700', color: BRAND },
});
