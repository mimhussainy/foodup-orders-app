import { Ionicons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Tabs } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { Platform, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

function FoodUpIcon({ focused, size }: { focused: boolean; size: number }) {
  const color = focused ? '#8B38CB' : '#8E8E93';
  return (
    <Svg width={size} height={size} viewBox="0 0 1181 1549.83">
      <Path
        fill={color}
        d="M950.16 500.69c128.75,-10.41 230,-118.2 230,-249.64 0,-138.32 -112.14,-250.45 -250.46,-250.45 -68.2,0 -130.04,27.26 -175.21,71.48 -89,-95.94 -240.72,-96 -329.81,-0.14 -45.15,-44.14 -106.93,-71.34 -175.07,-71.34 -138.32,0 -250.45,112.13 -250.45,250.45 0,132.47 102.84,240.92 233.04,249.86l717.96 -0.22z"
      />
      <Path
        fill={color}
        d="M396.05 896.29l521.78 0c72.48,0 131.79,-59.3 131.79,-131.79 0,-72.49 -59.31,-131.79 -131.79,-131.79l-653.57 0c-72.49,0 -131.8,59.3 -131.8,131.79l0 653.57c0,72.49 59.31,131.79 131.8,131.79 72.48,0 131.79,-59.3 131.79,-131.79l0 -521.78z"
      />
    </Svg>
  );
}

const TabLayout = React.memo(function TabLayout() {
  const [role, setRole] = useState<string | null>(null);
  const [roleLoaded, setRoleLoaded] = useState(false);
  const [bagCount, setBagCount] = useState(0);
  const insets = useSafeAreaInsets();

  useEffect(() => {
    const loadBagCount = async () => {
      const bagName = await AsyncStorage.getItem('delivery_name') || '';
      const stored = await AsyncStorage.getItem(`delivery_bag_${bagName}`);
      if (stored) {
        const bag = JSON.parse(stored);
        const active = bag.filter((o: any) => o.status === 'pending' || o.status === 'delivering');
        setBagCount(active.length);
      }
    };
    loadBagCount();
    const interval = setInterval(loadBagCount, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const loadRole = async () => {
      const r = await AsyncStorage.getItem('user_role');
      setRole(r);
      setRoleLoaded(true);
    };
    loadRole();
  }, []);

  if (!roleLoaded) return null;
  if (!role) return null;

  if (role === 'owner') {
    return (
      <Tabs
        initialRouteName="index"
        screenOptions={{
          headerShown: false,
          animation: 'none',
          tabBarStyle: { paddingTop: 10, paddingBottom: Platform.OS === 'android' ? insets.bottom + 10 : 30, height: Platform.OS === 'android' ? insets.bottom + 60 : 90 },
          tabBarLabelStyle: { fontSize: 12, marginTop: 2 },
          tabBarItemStyle: { flex: 1 },
          tabBarHideOnKeyboard: true,
        }}
      >
        <Tabs.Screen
          name="index"
          options={{
            title: 'Orders',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="receipt-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="stats"
          options={{
            title: 'Statistics',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="bar-chart-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen
          name="settings"
          options={{
            title: 'Settings',
            tabBarIcon: ({ color, size }) => (
              <Ionicons name="settings-outline" size={size} color={color} />
            ),
          }}
        />
        <Tabs.Screen name="delivery" options={{ href: null }} />
        <Tabs.Screen name="bag" options={{ href: null }} />
        <Tabs.Screen name="explore" options={{ href: null }} />
      </Tabs>
    );
  }

  return (
    <Tabs
      initialRouteName="delivery"
      screenOptions={{
        headerShown: false,
        animation: 'none',
        tabBarIconStyle: { transform: [{ translateX: 0 }] },
        tabBarStyle: { paddingTop: 10, paddingBottom: Platform.OS === 'android' ? insets.bottom + 10 : 30, height: Platform.OS === 'android' ? insets.bottom + 60 : 90 },
        tabBarLabelStyle: { fontSize: 12, marginTop: 2 },
        tabBarItemStyle: { flex: 1 },
      }}
    >
      <Tabs.Screen
        name="delivery"
        options={{
          title: 'Add Order',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="add-circle-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="bag"
        options={{
          title: 'Bag',
          tabBarIcon: ({ color, size }) => (
            <View>
              <Ionicons name="bag-outline" size={size} color={color} />
              {bagCount > 0 && (
                <View style={{
                  position: 'absolute',
                  right: -6,
                  top: -4,
                  backgroundColor: '#e74c3c',
                  borderRadius: 8,
                  minWidth: 16,
                  height: 16,
                  justifyContent: 'center',
                  alignItems: 'center',
                  paddingHorizontal: 3,
                }}>
                  <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{bagCount}</Text>
                </View>
              )}
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: 'Profile',
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="person-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen name="index" options={{ href: null }} />
      <Tabs.Screen name="explore" options={{ href: null }} />
      <Tabs.Screen name="stats" options={{ href: null }} />
    </Tabs>
  );
});

export default TabLayout;