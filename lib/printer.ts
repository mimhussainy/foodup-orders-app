import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Print from 'expo-print';
import { Alert } from 'react-native';

export async function printOrder(order: any, acceptedMinutes?: number, rejected?: boolean, rejectionReason?: string) {
  try {
    const logoHtml = `<img src="https://eatime.ch/wp-content/uploads/2026/05/print-logo.png" style="width:180px; display:block; margin:0 auto 8px auto;" />`;

    const items = order.items || [];
    const isPaid = !order.payment_method?.toLowerCase().includes('bar');

    let itemsHtml = '';
    items.forEach((item: any) => {
      if (item.category) {
        itemsHtml += `
        <tr>
          <td colspan="2" style="font-size:16px; font-weight:500; color:#333; padding-top:8px;"><b>${item.category.split(' - ')[0]}</b>${item.category.includes(' - ') ? ' - ' + item.category.split(' - ')[1] : ''}</td>
        </tr>`;
      }
      itemsHtml += `
        <tr>
          <td style="text-align:left; padding: 4px 0; font-size:18px; font-weight:bold;">${item.quantity}x ${item.name}</td>
          <td style="text-align:right; padding: 4px 0; font-size:18px; font-weight:bold; white-space:nowrap;">${item.total}</td>
        </tr>`;
      if (item.addons && item.addons.length > 0) {
        item.addons.forEach((addon: any) => {
          itemsHtml += `
          <tr>
            <td colspan="2" style="text-align:left; color:#333; font-size:16px; font-weight:600; padding-left:16px;">↳ ${addon.value}${addon.price ? ` (${order.currency} ${addon.price})` : ''}</td>
          </tr>`;
        });
      }
    });

    const lang = (await AsyncStorage.getItem('app_language') || 'de') as 'en' | 'de';
    const locale = lang === 'de' ? 'de-CH' : 'en-GB';
    const now = new Date();
    const timeStr = now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    const dateStr = now.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });

    // Requested delivery time from Orderable
    let requestedStr = `${timeStr}  ${dateStr}`;
    if (order.orderable_order_date && order.orderable_order_time) {
      const rawTime = order.orderable_order_time.replace(/\s*\(.*?\)\s*/g, '').trim();
      requestedStr = `${rawTime}  ${order.orderable_order_date}`;
    }
    const labels = {
      orderLabel: lang === 'de' ? 'Bestellung' : 'Order',
      createTime: lang === 'de' ? 'Erstellt' : 'CreateTime',
      requestedFor: lang === 'de' ? 'Gewünschte Lieferzeit' : 'Requested for',
      shipmentMethod: lang === 'de' ? 'Liefermethode' : 'Shipment Method',
      paymentMode: lang === 'de' ? 'Zahlungsart' : 'Payment Mode',
      subtotal: lang === 'de' ? 'Zwischensumme' : 'Subtotal',
      total: lang === 'de' ? 'Gesamt' : 'Total',
      notPaid: lang === 'de' ? 'Bestellung wurde<br>noch nicht bezahlt' : 'Order not yet paid',
      paid: lang === 'de' ? '✓ Bezahlt' : '✓ Paid',
      note: lang === 'de' ? 'Hinweis' : 'Note',
      acceptedFor: lang === 'de' ? 'Angenommen für' : 'Accepted for',
      minutes: lang === 'de' ? 'Minuten' : 'Minutes',
      rejected: lang === 'de' ? 'Abgelehnt' : 'Rejected',
    };

    const acceptanceHtml = acceptedMinutes ? `
      <div style="border-top:1.5px solid #000; margin:12px 0;"></div>
      <p style="text-align:left; font-size:16px; color:#333; margin:4px 0;">${labels.acceptedFor}:</p>
      <p style="text-align:left; font-size:18px; margin:2px 0;">${acceptedMinutes} ${labels.minutes}</p>
    ` : rejected ? `
      <div style="border-top:1.5px solid #000; margin:12px 0;"></div>
      <p style="text-align:left; font-size:16px; color:#333; margin:4px 0;">${labels.rejected}:</p>
      ${rejectionReason ? `<p style="text-align:left; font-size:18px; margin:2px 0;">${rejectionReason}</p>` : ''}
    ` : '';

    const html = `
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; font-size: 13px; margin: 0; padding: 10px; width: 280px; }
            .center { text-align: center; margin: 2px 0; }
            .divider { border-top: 1px solid #000; margin: 8px 0; }
            .divider-dashed { border-top: 1px dashed #000; margin: 8px 0; }
            table { width: 100%; border-collapse: collapse; }
            td { font-size: 13px; vertical-align: top; }
          </style>
        </head>
        <body>
          ${logoHtml}
          <h2 style="text-align:center; font-size:22px; font-weight:900; margin:6px 0 4px 0; letter-spacing:0;">${labels.orderLabel}#${order.order_id}</h2>
          <p style="font-size:16px; color:#333; margin:2px 0;">${labels.createTime}: <span style="float:right;">${timeStr}&nbsp;&nbsp;${dateStr}</span></p>
          <div class="divider"></div>
          <p style="text-align:center; font-size:17px; font-weight:bold; margin:2px 0; text-transform:uppercase; letter-spacing:1px;">${labels.requestedFor}:</p>
          <p style="text-align:center; font-size:22px; font-weight:900; margin:4px 0;">${requestedStr}</p>
          <div class="divider"></div>
          <table style="margin-bottom:6px;">
            <tr>
              <td style="width:50%;">
                <div style="font-size:15px; font-weight:bold; text-transform:uppercase; white-space:nowrap;">${labels.shipmentMethod}:</div>
                <div style="font-size:22px; font-weight:900; margin-top:2px;">${order.shipping_method || '-'}</div>
              </td>
              <td style="width:50%; text-align:right;">
                <div style="font-size:15px; font-weight:bold; text-transform:uppercase;">${labels.paymentMode}:</div>
                <div style="font-size:22px; font-weight:900; margin-top:2px; text-align:right;">${order.payment_method || '-'}</div>
              </td>
            </tr>
          </table>
          <div class="divider"></div>
          <p style="margin:4px 0; font-size:22px; font-weight:bold;">${order.customer_name || ''}</p>
          ${order.shipping_address ? `<p style="margin:4px 0; font-size:20px;">${order.shipping_address}</p>` : ''}
          ${order.customer_email ? `<p style="margin:4px 0; font-size:20px;">${order.customer_email}</p>` : ''}
          ${order.customer_phone ? `<p style="margin:4px 0; font-size:20px;">${order.customer_phone}</p>` : ''}
          <div class="divider"></div>
          <table>${itemsHtml}</table>
          <div class="divider-dashed"></div>
          <table>
            <tr>
              <td style="font-size:18px;">${labels.subtotal}</td>
              <td style="text-align:right; font-size:18px;">${order.total}</td>
            </tr>
          </table>
          <div class="divider"></div>
          <table>
            <tr>
              <td colspan="2" style="text-align:right; font-size:18px; font-weight:bold;">${labels.total}:&nbsp;&nbsp;${order.total}</td>
            </tr>
          </table>
          <div class="divider"></div>
          <p style="text-align:center; font-size:20px; font-weight:900; margin:8px 0; line-height:1.2;">${isPaid ? labels.paid : labels.notPaid}</p>
          ${order.note ? `<div class="divider-dashed"></div><p style="font-size:16px;">${labels.note}: ${order.note}</p>` : ''}
          ${acceptanceHtml}
        </body>
      </html>
    `;

    await Print.printAsync({ html });
    return true;

  } catch (e: any) {
    Alert.alert('Print Error', e?.message || String(e));
    return false;
  }
}