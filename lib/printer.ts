import AsyncStorage from '@react-native-async-storage/async-storage';
import { Alert, Platform } from 'react-native';

export async function printOrder(order: any, acceptedMinutes?: number, rejected?: boolean, rejectionReason?: string, scheduledTimeStr?: string) {
  try {
    const lang = (await AsyncStorage.getItem('app_language') || await AsyncStorage.getItem('language') || 'en') as 'en' | 'de';
    const locale = lang === 'de' ? 'de-CH' : 'en-GB';
    const now = new Date();
    const createdDate = order.date_created ? new Date(order.date_created) : now;
    const createdTimeStr = createdDate.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    const createdDateStr = createdDate.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });

    const isPaid = !order.payment_method?.toLowerCase().includes('bar');

    let requestedStr = '';
    if (order.orderable_order_date && order.orderable_order_time) {
      const isAsap = order.orderable_order_time.toLowerCase().includes('as soon as possible') ||
                     order.orderable_order_time.toLowerCase().includes('asap') ||
                     order.orderable_order_time.toLowerCase().includes('soon') ||
                     order.orderable_order_time.includes('(');
      if (isAsap) {
        requestedStr = lang === 'de' ? 'So schnell wie möglich' : 'As soon as possible';
      } else {
        const rawTime = order.orderable_order_time.replace(/\s*\(.*?\)\s*/g, '').trim();
        requestedStr = `${rawTime}  ${order.orderable_order_date}`;
      }
    }

    const labels = {
      orderLabel: lang === 'de' ? 'Bestellung' : 'Order',
      createTime: lang === 'de' ? 'Erstellt' : 'CreateTime',
      requestedFor: lang === 'de' ? 'Gewünschte Lieferzeit' : 'Requested for',
      shipmentMethod: lang === 'de' ? 'Liefermethode' : 'Shipment Method',
      paymentMode: lang === 'de' ? 'Zahlungsart' : 'Payment Mode',
      subtotal: lang === 'de' ? 'Zwischensumme' : 'Subtotal',
      total: lang === 'de' ? 'Gesamt' : 'Total',
      notPaid: lang === 'de' ? 'Noch nicht bezahlt' : 'Order not yet paid',
      paid: lang === 'de' ? '✓ Bezahlt' : '✓ Paid',
      note: lang === 'de' ? 'Hinweis' : 'Note',
      acceptedFor: lang === 'de' ? 'Angenommen für' : 'Accepted for',
      minutes: lang === 'de' ? 'Minuten' : 'Minutes',
      rejected: lang === 'de' ? 'Abgelehnt' : 'Rejected',
      scanQr: lang === 'de' ? 'QR-Code scannen für Navigation' : 'Scan for navigation',
    };

    const inferredScheduledStr = (() => {
      if (order.orderable_order_date && order.orderable_order_time) {
        const isAsap = order.orderable_order_time.toLowerCase().includes('as soon as possible') ||
                       order.orderable_order_time.toLowerCase().includes('asap') ||
                       order.orderable_order_time.includes('(');
        if (!isAsap) {
          const rawTime = order.orderable_order_time.replace(/\s*\(.*?\)\s*/g, '').trim();
          return `${rawTime} - ${order.orderable_order_date}`;
        }
      }
      return null;
    })();

    const resolvedScheduledStr = scheduledTimeStr || inferredScheduledStr;
    const resolvedMinutes = resolvedScheduledStr ? undefined : acceptedMinutes;

    // Try direct printing on Goodcom device
    if (Platform.OS === 'android') {
      try {
        const EzPrinter = require('react-native-expo-ezprinter').default;
        const { FontSize, AlignmentType, BarcodeType } = require('react-native-expo-ezprinter');

        const isSupported = await EzPrinter.isDeviceSupport();
        if (isSupported) {
          // Logo
          const logoBase64 = await fetchImageAsBase64('https://eatime.ch/wp-content/uploads/2026/05/print-logo.png');
          if (logoBase64) {
            EzPrinter.printImageByBase64(logoBase64, AlignmentType.Center, false);
          }

          // Order number
          EzPrinter.drawCustom(`${labels.orderLabel}#${order.order_id}`, FontSize.BigBold, AlignmentType.Center);
          EzPrinter.drawCustom(`${labels.createTime}: ${createdTimeStr}  ${createdDateStr}`, FontSize.Default, AlignmentType.Left);
          EzPrinter.drawOneLineDefault();

          // Requested time
          if (requestedStr) {
            EzPrinter.drawCustom(labels.requestedFor.toUpperCase(), FontSize.SmallBold, AlignmentType.Center);
            EzPrinter.drawCustom(requestedStr, FontSize.BigBold, AlignmentType.Center);
            EzPrinter.drawOneLineDefault();
          }

          // Shipment & Payment
          EzPrinter.drawText(
            `${labels.shipmentMethod}:`, FontSize.SmallBold,
            '', FontSize.Default,
            `${labels.paymentMode}:`, FontSize.SmallBold
          );
          EzPrinter.drawText(
            order.shipping_method || '-', FontSize.BigBold,
            '', FontSize.Default,
            order.payment_method || '-', FontSize.BigBold
          );
          EzPrinter.drawOneLineDefault();

          // Customer info
          EzPrinter.drawCustom(order.customer_name || '', FontSize.BigBold, AlignmentType.Left);
          if (order.shipping_address) EzPrinter.drawCustom(order.shipping_address, FontSize.MediumBold, AlignmentType.Left);
          if (order.customer_email) EzPrinter.drawCustom(order.customer_email, FontSize.MediumBold, AlignmentType.Left);
          if (order.customer_phone) EzPrinter.drawCustom(order.customer_phone, FontSize.MediumBold, AlignmentType.Left);
          EzPrinter.drawOneLineDefault();

          // Items
          const items = order.items || [];
          items.forEach((item: any) => {
            EzPrinter.drawLeftRight(
              `${item.quantity}x ${item.name}`, FontSize.MediumBold,
              `${item.total}`, FontSize.MediumBold
            );
            if (item.addons && item.addons.length > 0) {
              item.addons.forEach((addon: any) => {
                EzPrinter.drawCustom(`  > ${addon.value}${addon.price ? ` (${order.currency} ${addon.price})` : ''}`, FontSize.SmallBold, AlignmentType.Left);
              });
            }
          });

          // Total only
          EzPrinter.drawOneLineDefault();
          EzPrinter.drawLeftRight(`${labels.total}:`, FontSize.MediumBold, `${order.total}`, FontSize.MediumBold);
          EzPrinter.drawOneLineDefault();

          // Paid status
          EzPrinter.drawCustom(isPaid ? labels.paid : labels.notPaid, FontSize.BigBold, AlignmentType.Center);

          // Note
          if (order.note) {
            EzPrinter.drawOneLine(FontSize.Small);
            EzPrinter.drawCustom(`${labels.note}: ${order.note}`, FontSize.MediumBold, AlignmentType.Left);
          }

          // Acceptance / Rejection
          if (resolvedScheduledStr) {
            EzPrinter.drawOneLine(FontSize.Small);
            EzPrinter.drawCustom(`${labels.acceptedFor}: ${resolvedScheduledStr}`, FontSize.MediumBold, AlignmentType.Left);
          } else if (resolvedMinutes) {
            EzPrinter.drawOneLine(FontSize.Small);
            EzPrinter.drawCustom(`${labels.acceptedFor}: ${resolvedMinutes} ${labels.minutes}`, FontSize.MediumBold, AlignmentType.Left);
          } else if (rejected) {
            EzPrinter.drawOneLine(FontSize.Small);
            EzPrinter.drawCustom(`${labels.rejected}: ${rejectionReason || ''}`, FontSize.MediumBold, AlignmentType.Left);
          }

          // QR Code
          if (order.shipping_address) {
            EzPrinter.drawOneLine(FontSize.Small);
            const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.shipping_address)}`;
            EzPrinter.drawQrCodeWithHeight(mapsUrl, AlignmentType.Center, 304);
            EzPrinter.drawCustom(labels.scanQr, FontSize.Small, AlignmentType.Center);
          }

          EzPrinter.printText(true);
          return true;
        }
      } catch (ezError) {
        console.log('EzPrinter failed, falling back to expo-print:', ezError);
      }
    }

    // Fallback to expo-print (iOS or if EzPrinter not supported)
    const { default: Print } = await import('expo-print');
    const logoHtml = `<img src="https://eatime.ch/wp-content/uploads/2026/05/print-logo.png" style="width:220px; display:block; margin:0 auto 8px auto;" />`;

    const items = order.items || [];
    let itemsHtml = '';
    items.forEach((item: any) => {
      if (item.category) {
        itemsHtml += `<tr><td colspan="2" style="font-size:16px; font-weight:500; color:#333; padding-top:8px;"><b>${item.category.split(' - ')[0]}</b>${item.category.includes(' - ') ? ' - ' + item.category.split(' - ')[1] : ''}</td></tr>`;
      }
      itemsHtml += `<tr><td style="text-align:left; padding: 4px 0; font-size:18px; font-weight:bold;">${item.quantity}x ${item.name}</td><td style="text-align:right; padding: 4px 0; font-size:18px; font-weight:bold; white-space:nowrap;">${item.total}</td></tr>`;
      if (item.addons && item.addons.length > 0) {
        item.addons.forEach((addon: any) => {
          itemsHtml += `<tr><td colspan="2" style="text-align:left; color:#333; font-size:16px; font-weight:600; padding-left:16px;">↳ ${addon.value}${addon.price ? ` (${order.currency} ${addon.price})` : ''}</td></tr>`;
        });
      }
    });

    const acceptanceHtml = resolvedScheduledStr ? `
      <div style="border-top:1.5px solid #000; margin:12px 0;"></div>
      <p style="text-align:left; font-size:16px; color:#333; margin:4px 0;">${labels.acceptedFor}:</p>
      <p style="text-align:left; font-size:18px; margin:2px 0;">${resolvedScheduledStr}</p>
    ` : resolvedMinutes ? `
      <div style="border-top:1.5px solid #000; margin:12px 0;"></div>
      <p style="text-align:left; font-size:16px; color:#333; margin:4px 0;">${labels.acceptedFor}:</p>
      <p style="text-align:left; font-size:18px; margin:2px 0;">${resolvedMinutes} ${labels.minutes}</p>
    ` : rejected ? `
      <div style="border-top:1.5px solid #000; margin:12px 0;"></div>
      <p style="text-align:left; font-size:16px; color:#333; margin:4px 0;">${labels.rejected}:</p>
      ${rejectionReason ? `<p style="text-align:left; font-size:18px; margin:2px 0;">${rejectionReason}</p>` : ''}
    ` : '';

    const html = `
      <html><head><meta charset="utf-8">
      <style>body { font-family: Arial, sans-serif; font-size: 13px; margin: 0; padding: 10px; width: 280px; } .divider { border-top: 1px solid #000; margin: 8px 0; } .divider-dashed { border-top: 1px dashed #000; margin: 8px 0; } table { width: 100%; border-collapse: collapse; } td { font-size: 13px; vertical-align: top; }</style>
      </head><body>
        ${logoHtml}
        <h2 style="text-align:center; font-size:22px; font-weight:900; margin:6px 0 4px 0;">${labels.orderLabel}#${order.order_id}</h2>
        <p style="font-size:16px; color:#333; margin:2px 0;">${labels.createTime}: <span style="float:right;">${createdTimeStr}&nbsp;&nbsp;${createdDateStr}</span></p>
        <div class="divider"></div>
        <p style="text-align:center; font-size:17px; font-weight:bold; margin:2px 0; text-transform:uppercase;">${labels.requestedFor}:</p>
        <p style="text-align:center; font-size:22px; font-weight:900; margin:4px 0;">${requestedStr}</p>
        <div class="divider"></div>
        <table style="margin-bottom:6px;"><tr>
          <td style="width:50%;"><div style="font-size:15px; font-weight:bold; text-transform:uppercase;">${labels.shipmentMethod}:</div><div style="font-size:22px; font-weight:900; margin-top:2px;">${order.shipping_method || '-'}</div></td>
          <td style="width:50%; text-align:right;"><div style="font-size:15px; font-weight:bold; text-transform:uppercase;">${labels.paymentMode}:</div><div style="font-size:22px; font-weight:900; margin-top:2px;">${order.payment_method || '-'}</div></td>
        </tr></table>
        <div class="divider"></div>
        <p style="margin:4px 0; font-size:22px; font-weight:bold;">${order.customer_name || ''}</p>
        ${order.shipping_address ? `<p style="margin:4px 0; font-size:20px;">${order.shipping_address}</p>` : ''}
        ${order.customer_email ? `<p style="margin:4px 0; font-size:20px;">${order.customer_email}</p>` : ''}
        ${order.customer_phone ? `<p style="margin:4px 0; font-size:20px;">${order.customer_phone}</p>` : ''}
        <div class="divider"></div>
        <table>${itemsHtml}</table>
        <div class="divider-dashed"></div>
        <table><tr><td style="font-size:18px;">${labels.subtotal}</td><td style="text-align:right; font-size:18px;">${order.total}</td></tr></table>
        <div class="divider"></div>
        <table><tr><td colspan="2" style="text-align:right; font-size:18px; font-weight:bold;">${labels.total}:&nbsp;&nbsp;${order.total}</td></tr></table>
        <div class="divider"></div>
        <p style="text-align:center; font-size:20px; font-weight:900; margin:8px 0;">${isPaid ? labels.paid : labels.notPaid}</p>
        ${order.note ? `<div class="divider-dashed"></div><p style="font-size:16px;">${labels.note}: ${order.note}</p>` : ''}
        ${acceptanceHtml}
        ${order.shipping_address ? `
        <div style="border-top:1px dashed #000; margin:12px 0;"></div>
        <div style="text-align:center; margin:8px 0;">
          <img src="https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent('https://www.google.com/maps/search/?api=1&query=' + order.shipping_address)}" width="120" height="120" style="display:block; margin:0 auto;" />
        </div>
        <p style="text-align:center; font-size:11px; color:#666; margin:4px 0;">${labels.scanQr}</p>
        ` : ''}
      </body></html>
    `;

    await Print.printAsync({ html });
    return true;

  } catch (e: any) {
    Alert.alert('Print Error', e?.message || String(e));
    return false;
  }
}

async function fetchImageAsBase64(url: string): Promise<string | null> {
  try {
    const response = await fetch(url);
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result as string);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}