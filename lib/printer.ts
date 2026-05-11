import { Alert, PermissionsAndroid, Platform } from 'react-native';
import { BluetoothEscposPrinter, BluetoothManager } from 'react-native-bluetooth-escpos-printer';

export async function printOrder(order: any) {
  if (Platform.OS !== 'android') {
    Alert.alert('Printer', 'Printing only supported on Android');
    return false;
  }

  try {
    // Request Bluetooth permissions
    if (Platform.Version >= 31) {
      const granted = await PermissionsAndroid.requestMultiple([
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
        PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
      ]);
      if (
        granted['android.permission.BLUETOOTH_SCAN'] !== 'granted' ||
        granted['android.permission.BLUETOOTH_CONNECT'] !== 'granted'
      ) {
        Alert.alert('Permission denied', 'Bluetooth permissions are required for printing');
        return false;
      }
    }

    // Check if Bluetooth is enabled
    const isEnabled = await BluetoothManager.isBluetoothEnabled();
    if (!isEnabled) {
      await BluetoothManager.enableBluetooth();
    }

    // Print header
    await BluetoothEscposPrinter.printerAlign(BluetoothEscposPrinter.ALIGN.CENTER);
    await BluetoothEscposPrinter.setBlob(0);
    await BluetoothEscposPrinter.printText('FoodUp\n', { fonttype: 1, widthtimes: 2, heigthtimes: 2 });
    await BluetoothEscposPrinter.printText(`Order #${order.order_id}\n`, { fonttype: 1, widthtimes: 1, heigthtimes: 1 });
    await BluetoothEscposPrinter.printText(`${order.date || new Date().toLocaleString()}\n\n`, {});

    // Divider
    await BluetoothEscposPrinter.printText('--------------------------------\n', {});

    // Shipping & Payment
    await BluetoothEscposPrinter.printerAlign(BluetoothEscposPrinter.ALIGN.LEFT);
    await BluetoothEscposPrinter.printText(`${order.shipping_method || ''}   ${order.payment_method || ''}\n\n`, {});

    // Customer info
    await BluetoothEscposPrinter.printText('--------------------------------\n', {});
    if (order.customer_name) await BluetoothEscposPrinter.printText(`${order.customer_name}\n`, {});
    if (order.shipping_address) await BluetoothEscposPrinter.printText(`${order.shipping_address}\n`, {});
    if (order.customer_phone) await BluetoothEscposPrinter.printText(`${order.customer_phone}\n`, {});
    await BluetoothEscposPrinter.printText('--------------------------------\n\n', {});

    // Items
    const items = order.items || [];
    for (const item of items) {
      await BluetoothEscposPrinter.printText(`${item.quantity}x ${item.name}  ${order.currency} ${item.total}\n`, {});
      if (item.addons && item.addons.length > 0) {
        for (const addon of item.addons) {
          await BluetoothEscposPrinter.printText(`  ${addon.value}\n`, {});
        }
      }
    }

    // Total
    await BluetoothEscposPrinter.printText('--------------------------------\n', {});
    await BluetoothEscposPrinter.printerAlign(BluetoothEscposPrinter.ALIGN.CENTER);
    await BluetoothEscposPrinter.printText(`Total: ${order.currency} ${order.total}\n\n`, { fonttype: 1, widthtimes: 1, heigthtimes: 1 });

    // Payment status
    const isPaid = !order.payment_method?.toLowerCase().includes('bar');
    await BluetoothEscposPrinter.printText(isPaid ? 'Bezahlt\n' : 'Noch nicht bezahlt\n', {});

    // Note
    if (order.note) {
      await BluetoothEscposPrinter.printText('--------------------------------\n', {});
      await BluetoothEscposPrinter.printerAlign(BluetoothEscposPrinter.ALIGN.LEFT);
      await BluetoothEscposPrinter.printText(`Note: ${order.note}\n`, {});
    }

    // Feed paper
    await BluetoothEscposPrinter.printText('\n\n\n', {});

    return true;

  } catch (e: any) {
    Alert.alert('Print Error', e?.message || String(e));
    console.log('Print error:', e);
    return false;
  }
}