import { Alert, Platform } from 'react-native';
import ThermalPrinterModule from 'react-native-thermal-printer';

export async function printOrder(order: any) {
  if (Platform.OS !== 'android') {
    Alert.alert('Printer', 'Printing only supported on Android');
    return false;
  }

  try {
    const items = order.items || [];
    let itemsText = '';
    items.forEach((item: any) => {
      itemsText += `[L]${item.quantity}x ${item.name}[R]${order.currency} ${item.total}\n`;
      if (item.addons && item.addons.length > 0) {
        item.addons.forEach((addon: any) => {
          itemsText += `[L]  ${addon.value}\n`;
        });
      }
    });

    const isPaid = !order.payment_method?.toLowerCase().includes('bar');

    const text =
      `[C]<b>FoodUp</b>\n` +
      `[C]Order #${order.order_id}\n` +
      `[C]${order.date || new Date().toLocaleString()}\n` +
      `[C]================================\n` +
      `[L]${order.shipping_method || ''}[R]${order.payment_method || ''}\n` +
      `[C]================================\n` +
      `[L]${order.customer_name || ''}\n` +
      `[L]${order.shipping_address || ''}\n` +
      `[L]${order.customer_phone || ''}\n` +
      `[C]================================\n` +
      itemsText +
      `[C]================================\n` +
      `[C]<b>Total: ${order.currency} ${order.total}</b>\n` +
      `[C]${isPaid ? 'Bezahlt' : 'Noch nicht bezahlt'}\n` +
      (order.note ? `[L]Note: ${order.note}\n` : '') +
      `[L]\n[L]\n[L]\n`;

    await ThermalPrinterModule.printBluetooth({ payload: text, printerNbrCharactersPerLine: 32 });
    return true;

  } catch (e: any) {
    Alert.alert('Print Error', e?.message || String(e));
    return false;
  }
}