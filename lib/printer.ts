import * as Print from 'expo-print';
import { Alert } from 'react-native';

export async function printOrder(order: any, acceptedMinutes?: number, rejected?: boolean, rejectionReason?: string) {
  try {
    const logoHtml = '';

    const items = order.items || [];
    const isPaid = !order.payment_method?.toLowerCase().includes('bar');

    let itemsHtml = '';
    items.forEach((item: any) => {
      if (item.category) {
        itemsHtml += `
        <tr>
          <td colspan="2" style="font-size:11px; color:#666; padding-top:6px;">${item.category}</td>
        </tr>`;
      }
      itemsHtml += `
        <tr>
          <td style="text-align:left; padding: 4px 0;"><b>${item.quantity}x ${item.name}</b></td>
          <td style="text-align:right; padding: 4px 0;">${item.total}</td>
        </tr>`;
      if (item.addons && item.addons.length > 0) {
        item.addons.forEach((addon: any) => {
          itemsHtml += `
          <tr>
            <td colspan="2" style="text-align:left; color:#666; font-size:11px; padding-left:12px;">↳ ${addon.value}${addon.price ? ` (${order.currency} ${addon.price})` : ''}</td>
          </tr>`;
        });
      }
    });

    const now = new Date();
    const timeStr = now.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
    const dateStr = now.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const acceptanceHtml = acceptedMinutes ? `
      <div style="border-top:1px solid #000; margin:8px 0;"></div>
      <p style="text-align:left; font-size:11px; color:#333; margin:4px 0;">Accepted for:</p>
      <p style="text-align:left; font-size:13px; margin:2px 0;">${acceptedMinutes} Minutes</p>
    ` : rejected ? `
      <div style="border-top:1px solid #000; margin:8px 0;"></div>
      <p style="text-align:left; font-size:11px; color:#333; margin:4px 0;">Rejected:</p>
      ${rejectionReason ? `<p style="text-align:left; font-size:13px; margin:2px 0;">${rejectionReason}</p>` : ''}
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
          <h2 style="text-align:center; font-size:22px; font-weight:900; margin:6px 0 2px 0; letter-spacing:0;">Order#${order.order_id}</h2>
          <p style="font-size:11px; color:#333; margin:2px 0;">CreateTime: <span style="float:right;">${timeStr}&nbsp;&nbsp;${dateStr}</span></p>
          <div class="divider"></div>
          <p style="text-align:center; font-size:11px; font-weight:bold; margin:2px 0; text-transform:uppercase; letter-spacing:1px;">Requested for:</p>
          <p style="text-align:center; font-size:20px; font-weight:900; margin:2px 0;">${timeStr}&nbsp;&nbsp;${dateStr.replace(/\./g, '-')}</p>
          <div class="divider"></div>
          <table style="margin-bottom:4px;">
            <tr>
              <td style="width:50%;">
                <div style="font-size:11px; font-weight:bold; text-transform:uppercase;">Shipment Method:</div>
                <div style="font-size:15px; font-weight:900;">${order.shipping_method || '-'}</div>
              </td>
              <td style="width:50%;">
                <div style="font-size:11px; font-weight:bold; text-transform:uppercase;">Payment Mode:</div>
                <div style="font-size:15px; font-weight:900;">${order.payment_method || '-'}</div>
              </td>
            </tr>
          </table>
          <div class="divider"></div>
          <p style="margin:3px 0;">${order.customer_name || ''}</p>
          ${order.shipping_address ? `<p style="margin:3px 0;">${order.shipping_address}</p>` : ''}
          ${order.customer_email ? `<p style="margin:3px 0; font-size:11px;">${order.customer_email}</p>` : ''}
          ${order.customer_phone ? `<p style="margin:3px 0;">${order.customer_phone}</p>` : ''}
          <div class="divider"></div>
          <table>${itemsHtml}</table>
          <div class="divider-dashed"></div>
          <table>
            <tr>
              <td style="font-size:13px;">Subtotal</td>
              <td style="text-align:right; font-size:13px;">${order.total}</td>
            </tr>
          </table>
          <div class="divider"></div>
          <table>
            <tr>
              <td colspan="2" style="text-align:right; font-size:16px; font-weight:bold;">Total:&nbsp;&nbsp;${order.total}</td>
            </tr>
          </table>
          <div class="divider"></div>
          <p style="font-size:20px; font-weight:900; margin:6px 0;">${isPaid ? '✓ Bezahlt' : 'Bestellung wurde<br>noch nicht bezahlt'}</p>
          ${order.note ? `<div class="divider-dashed"></div><p style="font-size:12px;">Note: ${order.note}</p>` : ''}
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