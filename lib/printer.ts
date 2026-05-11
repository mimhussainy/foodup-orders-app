import { Alert } from 'react-native';

export async function printOrder(order: any) {
  Alert.alert('Print', `Order #${order.order_id} - Printer coming soon!`);
  return true;
}