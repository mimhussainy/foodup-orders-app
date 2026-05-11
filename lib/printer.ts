import { Alert, Platform } from 'react-native';

export async function printOrder(order: any) {
  if (Platform.OS !== 'android') {
    Alert.alert('Printer', 'Android only');
    return false;
  }

  try {
    const EzPrinterModule = require('react-native-ezprinter');
    const EzPrinter = EzPrinterModule.default || EzPrinterModule;
    const { AlignmentType, FontSize } = EzPrinterModule;

    Alert.alert('Step 1', 'Module loaded');

    EzPrinter.drawCustom('FoodUp TEST', FontSize.Big, AlignmentType.Center);
    EzPrinter.drawNewLine();
    EzPrinter.drawCustom('Printer should print this', FontSize.Default, AlignmentType.Center);
    EzPrinter.drawNewLine();
    EzPrinter.drawNewLine();
    EzPrinter.drawNewLine();

    await EzPrinter.printText(true);

    Alert.alert('Step 2', 'Print sent');
    return true;

  } catch (e: any) {
    Alert.alert('Print Error', e?.message || String(e));
    console.log('Print error:', e);
    return false;
  }
}