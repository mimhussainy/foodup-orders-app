import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import React from 'react';
import { Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import { useLanguage } from '../../lib/useLanguage';

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
  const insets = useSafeAreaInsets();
  const { t } = useLanguage();

  return (
    <Tabs
      initialRouteName="index"
      screenOptions={{
        headerShown: false,
        animation: 'none',
        tabBarStyle: { paddingTop: 10, paddingBottom: Platform.OS === 'android' ? insets.bottom + 15 : 30, height: Platform.OS === 'android' ? insets.bottom + 65 : 90 },
        tabBarLabelStyle: { fontSize: 12, marginTop: 2 },
        tabBarItemStyle: { flex: 1 },
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: t.tabOrders,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="receipt-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="stats"
        options={{
          title: t.tabStatistics,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="bar-chart-outline" size={size} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="settings"
        options={{
          title: t.tabSettings,
          tabBarIcon: ({ color, size }) => (
            <Ionicons name="settings-outline" size={size} color={color} />
          ),
        }}
      />
    </Tabs>
  );
});

export default TabLayout;