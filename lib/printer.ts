import { Alert } from 'react-native';

export async function printOrder(order: any) {
  Alert.alert('Printer', 'Bluetooth printer coming soon!');
  return false;
}