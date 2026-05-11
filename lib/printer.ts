import { Alert, Platform } from 'react-native';

export async function printOrder(order: any) {
  if (Platform.OS !== 'android') {
    Alert.alert('Printer', 'Printing only supported on Android');
    return false;
  }

  try {
    const EzPrinterModule = require('react-native-ezprinter');
    const EzPrinter = EzPrinterModule.default || EzPrinterModule;
    const { AlignmentType, FontSize } = EzPrinterModule;

    // Header
    EzPrinter.drawCustom('FoodUp', FontSize.Big, AlignmentType.Center);
    EzPrinter.drawNewLine();
    EzPrinter.drawCustom(`Order #${order.order_id}`, FontSize.DoubleHeight, AlignmentType.Center);
    EzPrinter.drawNewLine();
    EzPrinter.drawCustom(order.date || new Date().toLocaleString(), FontSize.Small, AlignmentType.Center);
    EzPrinter.drawOneLine(FontSize.Default);
    EzPrinter.drawNewLine();

    // Shipment & Payment
    EzPrinter.drawCustom(`${order.shipping_method || ''}   ${order.payment_method || ''}`, FontSize.Default, AlignmentType.Left);
    EzPrinter.drawNewLine();
    EzPrinter.drawOneLine(FontSize.Default);
    EzPrinter.drawNewLine();

    // Customer info
    if (order.customer_name) EzPrinter.drawCustom(order.customer_name, FontSize.Default, AlignmentType.Left);
    if (order.shipping_address) EzPrinter.drawCustom(order.shipping_address, FontSize.Default, AlignmentType.Left);
    if (order.customer_email) EzPrinter.drawCustom(order.customer_email, FontSize.Small, AlignmentType.Left);
    if (order.customer_phone) EzPrinter.drawCustom(order.customer_phone, FontSize.Default, AlignmentType.Left);
    EzPrinter.drawNewLine();
    EzPrinter.drawOneLine(FontSize.Default);
    EzPrinter.drawNewLine();

    // Items
    const items = order.items || [];
    items.forEach((item: any) => {
      EzPrinter.drawCustom(`${item.quantity}x ${item.name}  ${order.currency} ${item.total}`, FontSize.Default, AlignmentType.Left);
      if (item.addons && item.addons.length > 0) {
        item.addons.forEach((addon: any) => {
          EzPrinter.drawCustom(`  ${addon.value}`, FontSize.Small, AlignmentType.Left);
        });
      }
    });

    EzPrinter.drawOneLine(FontSize.Default);
    EzPrinter.drawNewLine();

    // Total
    EzPrinter.drawCustom(`Total: ${order.currency} ${order.total}`, FontSize.Medium, AlignmentType.Center);
    EzPrinter.drawNewLine();
    EzPrinter.drawOneLine(FontSize.Default);
    EzPrinter.drawNewLine();

    // Payment status
    const isPaid = !order.payment_method?.toLowerCase().includes('bar');
    EzPrinter.drawCustom(
      isPaid ? 'Bezahlt' : 'Bestellung wurde noch nicht bezahlt',
      FontSize.Medium,
      AlignmentType.Center
    );
    EzPrinter.drawNewLine();

    // Note
    if (order.note) {
      EzPrinter.drawOneLine(FontSize.Default);
      EzPrinter.drawCustom(`Note: ${order.note}`, FontSize.Default, AlignmentType.Left);
      EzPrinter.drawNewLine();
    }

    EzPrinter.drawNewLine();
    EzPrinter.drawNewLine();

    await EzPrinter.printText(true);
    return true;

  } catch (e: any) {
    Alert.alert('Print Error', e?.message || String(e));
    console.log('Print error:', e);
    return false;
  }
}