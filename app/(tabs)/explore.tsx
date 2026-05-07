import { Image, Linking, SafeAreaView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default function ContactScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.headerContainer}>
        <Image source={require('../../assets/images/logo.png')} style={styles.logo} resizeMode="contain" />
      </View>
      <View style={styles.card}>
        <Text style={styles.title}>Online-Bestellsystem für Restaurants</Text>

        <TouchableOpacity style={styles.row} onPress={() => Linking.openURL('https://www.foodup.ch')}>
          <Text style={styles.icon}>🌐</Text>
          <Text style={styles.link}>www.foodup.ch</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.row} onPress={() => Linking.openURL('mailto:info@foodup.ch')}>
          <Text style={styles.icon}>✉️</Text>
          <Text style={styles.link}>info@foodup.ch</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.row} onPress={() => Linking.openURL('https://wa.me/41783222292')}>
          <Text style={styles.icon}>💬</Text>
          <Text style={styles.link}>WhatsApp: +41 78 322 22 92</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.row} onPress={() => Linking.openURL('tel:+41432295051')}>
          <Text style={styles.icon}>📞</Text>
          <Text style={styles.link}>Tel: +41 43 229 50 51</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  headerContainer: { alignItems: 'center', paddingVertical: 12 },
  logo: { height: 40, width: 160 },
  card: { backgroundColor: '#fff', margin: 16, padding: 20, borderRadius: 12, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2 },
  title: { fontSize: 16, color: '#666', marginBottom: 24, textAlign: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  icon: { fontSize: 20, marginRight: 12 },
  link: { fontSize: 15, color: '#007AFF' },
});