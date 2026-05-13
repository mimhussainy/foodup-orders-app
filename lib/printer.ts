import { Alert } from 'react-native';

export async function printOrder(order: any, acceptedMinutes?: number, rejected?: boolean, rejectionReason?: string) {
  try {
    const items = order.items || [];
    const isPaid = !order.payment_method?.toLowerCase().includes('bar');

    let itemsHtml = '';
    items.forEach((item: any) => {
      itemsHtml += `
        <tr>
          <td style="text-align:left; padding: 4px 0;"><b>${item.quantity}x ${item.name}</b></td>
          <td style="text-align:right; padding: 4px 0;">${order.currency} ${item.total}</td>
        </tr>`;
      if (item.addons && item.addons.length > 0) {
        item.addons.forEach((addon: any) => {
          itemsHtml += `
          <tr>
            <td colspan="2" style="text-align:left; color:#666; font-size:11px; padding-left:12px">↳ ${addon.value}</td>
          </tr>`;
        });
      }
    });

    const now = new Date();
    const timeStr = now.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
    const dateStr = now.toLocaleDateString('de-CH', { day: '2-digit', month: '2-digit', year: 'numeric' });

    const acceptanceHtml = acceptedMinutes ? `
      <div class="divider"></div>
      <p style="text-align:center; font-size:16px; font-weight:bold; margin:6px 0;">✓ Accepted</p>
      <p style="text-align:center; font-size:14px; margin:4px 0;">Ready in: <b>${acceptedMinutes} Minutes</b></p>
    ` : rejected ? `
      <div class="divider"></div>
      <p style="text-align:center; font-size:16px; font-weight:bold; color:#e74c3c; margin:6px 0;">✗ Rejected</p>
      ${rejectionReason ? `<p style="text-align:center; font-size:13px; margin:4px 0;">Reason: ${rejectionReason}</p>` : ''}
    ` : '';

    const html = `
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: monospace; font-size: 13px; margin: 0; padding: 8px; width: 280px; }
            h2 { text-align: center; margin: 4px 0; font-size: 20px; letter-spacing: 2px; }
            .center { text-align: center; margin: 2px 0; }
            .divider { border-top: 1px dashed #000; margin: 6px 0; }
            table { width: 100%; border-collapse: collapse; }
            td { font-size: 13px; }
            .label { font-size: 10px; color: #666; text-transform: uppercase; letter-spacing: 1px; }
            .value { font-size: 13px; font-weight: bold; }
          </style>
        </head>
        <body>
          <h2>FoodUp</h2>
          <p class="center">Order #${order.order_id}</p>
          <p class="center" style="font-size:11px; color:#666;">CreateTime: ${timeStr} ${dateStr}</p>
          <div class="divider"></div>
          <table>
            <tr>
              <td>
                <div class="label">Shipment Method:</div>
                <div class="value">${order.shipping_method || '-'}</div>
              </td>
              <td style="text-align:right">
                <div class="label">Payment Mode:</div>
                <div class="value">${order.payment_method || '-'}</div>
              </td>
            </tr>
          </table>
          <div class="divider"></div>
          <p style="margin:3px 0; font-weight:bold;">${order.customer_name || ''}</p>
          ${order.shipping_address ? `<p style="margin:3px 0;">${order.shipping_address}</p>` : ''}
          ${order.customer_email ? `<p style="margin:3px 0; font-size:11px;">${order.customer_email}</p>` : ''}
          ${order.customer_phone ? `<p style="margin:3px 0;">${order.customer_phone}</p>` : ''}
          <div class="divider"></div>
          <table>${itemsHtml}</table>
          <div class="divider"></div>
          <table>
            <tr>
              <td style="font-size:13px;">Subtotal</td>
              <td style="text-align:right; font-size:13px;">${order.currency} ${order.total}</td>
            </tr>
          </table>
          <div class="divider"></div>
          <table>
            <tr>
              <td colspan="2" style="text-align:right; font-size:16px; font-weight:bold;">Total: ${order.currency} ${order.total}</td>
            </tr>
          </table>
          <div class="divider"></div>
          <p style="text-align:center; font-size:15px; font-weight:bold; margin:6px 0;">${isPaid ? '✓ Bezahlt' : 'Bestellung wurde\nnoch nicht bezahlt'}</p>
          ${order.note ? `<div class="divider"></div><p style="font-size:12px;">Note: ${order.note}</p>` : ''}
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