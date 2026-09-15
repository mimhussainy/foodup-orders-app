import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Application from 'expo-application';
import * as Print from 'expo-print';
import { Platform } from 'react-native';
import { getOrderPrimaryLabel, getTableLabel, isDineInOrder } from './orderDisplay';

let isPrinting = false;


const PRINTER_BACKEND_URL =
  'https://foodup-order-alerts-backend.onrender.com';

async function verifyRegisteredPrinterDevice(): Promise<boolean> {
  // Existing non-Android behaviour remains unchanged.
  if (Platform.OS !== 'android') return true;

  try {
    const restaurantCode =
      (await AsyncStorage.getItem('restaurant_code') || '')
        .toLowerCase()
        .trim();

    const currentDeviceId =
      Application.getAndroidId() || '';

    if (!restaurantCode || !currentDeviceId) {
      await AsyncStorage.setItem('can_print', 'false');
      console.log(
        '[print-permission] BLOCKED: restaurant code or Android ID missing'
      );
      return false;
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      3000
    );

    try {
      const response = await fetch(
        `${PRINTER_BACKEND_URL}/printer-device/${restaurantCode}`,
        {
          signal: controller.signal,
        }
      );

      const result = await response
        .json()
        .catch(() => ({}));

      const registeredDeviceId =
        String(result?.device_id || '').trim();

      const allowed =
        response.ok &&
        result?.success === true &&
        registeredDeviceId !== '' &&
        registeredDeviceId === currentDeviceId;

      await AsyncStorage.setItem(
        'can_print',
        allowed ? 'true' : 'false'
      );

      console.log(
        `[print-permission] restaurant:${restaurantCode} current:${currentDeviceId} registered:${registeredDeviceId || 'none'} allowed:${allowed}`
      );

      return allowed;
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    // Fail closed: an unverified device must never print.
    await AsyncStorage
      .setItem('can_print', 'false')
      .catch(() => {});

    console.log(
      '[print-permission] BLOCKED: verification failed:',
      error instanceof Error
        ? error.message
        : String(error)
    );

    return false;
  }
}


function normalizePrintLogoScale(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 100;
  return Math.max(60, Math.min(140, Math.round(parsed)));
}

async function fetchJsonWithTimeout(url: string, timeoutMs = 3500): Promise<any> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function resolvePrintBranding(code: string): Promise<{ logoUrl: string; scale: number }> {
  const logoCacheKey = `foodup_print_logo_url_${code}`;
  const scaleCacheKey = `foodup_print_logo_scale_${code}`;

  let logoUrl = (await AsyncStorage.getItem(logoCacheKey)) || '';
  let scale = normalizePrintLogoScale(await AsyncStorage.getItem(scaleCacheKey));

  try {
    const profileData = await fetchJsonWithTimeout(
      `${PRINTER_BACKEND_URL}/restaurant-profile/${encodeURIComponent(code)}`
    );
    const profile = profileData?.profile || {};

    const backendLogo = String(profile?.print_logo_url || '').trim();
    if (backendLogo) {
      logoUrl = backendLogo;
    }

    const website = String(profile?.website || '').trim().replace(/\/+$/, '');
    if (website) {
      try {
        const brandingData = await fetchJsonWithTimeout(
          `${website}/wp-json/foodup/v1/app-profile?foodup_cache_bust=${Date.now()}`
        );

        const directLogo = String(brandingData?.print_logo_url || '').trim();
        if (directLogo) {
          logoUrl = directLogo;
        }

        scale = normalizePrintLogoScale(brandingData?.print_logo_scale);
      } catch (error) {
        console.log(
          '[print-branding] WordPress branding refresh failed; using cached/backend values:',
          error instanceof Error ? error.message : String(error)
        );
      }
    }

    if (logoUrl) {
      await AsyncStorage.setItem(logoCacheKey, logoUrl);
    }
    await AsyncStorage.setItem(scaleCacheKey, String(scale));
  } catch (error) {
    console.log(
      '[print-branding] backend profile refresh failed; using cached values:',
      error instanceof Error ? error.message : String(error)
    );
  }

  return { logoUrl, scale };
}

export async function printOrder(order: any, acceptedMinutes?: number, rejected?: boolean, rejectionReason?: string, scheduledTimeStr?: string, deliveredBy?: string) {
  const registeredPrinter = await verifyRegisteredPrinterDevice();
  if (!registeredPrinter) {
    console.log(`[print] BLOCKED order ${order?.order_id} ? this device is not the registered printer`);
    return false;
  }

  if (isPrinting) {
    console.log(`[print] blocked — already printing`);
    return false;
  }
  isPrinting = true;
  console.log(`[print] started for order ${order?.order_id}`);
  try {
    let logoHtml = '';
    try {
      const code = await AsyncStorage.getItem('restaurant_code') || '';
      const branding = await resolvePrintBranding(code);

      if (branding.logoUrl) {
        const logoWidth = Math.round(220 * (branding.scale / 100));
        logoHtml = `<img src="${branding.logoUrl}" style="width:${logoWidth}px; max-width:90%; height:auto; display:block; margin:0 auto 8px auto;" />`;
      }
    } catch (e) {}

    const items = order.items || [];
    const isPaid = !(order.payment_method?.toLowerCase().includes('bar') || order.payment_method?.toLowerCase().includes('cash'));

    let itemsHtml = '';
    items.forEach((item: any) => {
      const itemName = String(item.name || '').trim();
      const variationText = String(item.variation || '').trim();

      const pizzaSizeMatch = variationText.match(/(?:Ø\s*)?(\d{2,3})\s*cm/i);
      const pizzaSize = pizzaSizeMatch ? `${pizzaSizeMatch[1]}cm` : '';

      const itemNameHasPizzaSize = pizzaSize
        ? itemName.replace(/\s+/g, '').toLowerCase().includes(pizzaSize.toLowerCase())
        : false;

      const displayName = pizzaSize && !itemNameHasPizzaSize
        ? `${pizzaSize} ${itemName}`
        : itemName;

      itemsHtml += `
        <tr>
          <td style="text-align:left; padding: 0; font-size:18px; font-weight:bold;">${item.quantity}x ${displayName}</td>
          <td style="text-align:right; padding: 0; font-size:18px; font-weight:bold; white-space:nowrap;">${parseFloat(String(item.total || '0')).toFixed(2)}</td>
        </tr>`;
      if (item.addons && item.addons.length > 0) {
        item.addons.forEach((addon: any) => {
          itemsHtml += `
          <tr>
            <td colspan="2" style="text-align:left; color:#333; font-size:16px; font-weight:600; padding-left:16px;">↳ ${addon.value}${addon.price ? ` (${order.currency} ${addon.price})` : ''}</td>
          </tr>`;
        });
      }
      itemsHtml += `<tr><td colspan="2" style="padding-bottom:8px;"></td></tr>`;
    });

    const lang = (await AsyncStorage.getItem('app_language') || await AsyncStorage.getItem('language') || 'en') as 'en' | 'de';
    const locale = lang === 'de' ? 'de-CH' : 'en-GB';
    const now = new Date();
    const timeStr = now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    const dateStr = now.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });

    // Use order creation time for CreateTime field
    const createdDate = order.date_created ? new Date(order.date_created) : now;
    const createdTimeStr = createdDate.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    const createdDateStr = createdDate.toLocaleDateString(locale, { day: '2-digit', month: '2-digit', year: 'numeric' });

    // Requested delivery time from Orderable
    console.log('=== ORDERABLE TIME:', order.orderable_order_time, 'DATE:', order.orderable_order_date);
    let requestedStr = `${timeStr}  ${dateStr}`;
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
      notPaid: lang === 'de' ? 'Bestellung wurde<br>noch nicht bezahlt' : 'Order not yet paid',
      paid: lang === 'de' ? '✓ Bezahlt' : '✓ Paid',
      note: lang === 'de' ? 'Hinweis' : 'Note',
      acceptedFor: lang === 'de' ? 'Angenommen für' : 'Accepted for',
      preOrderFor: lang === 'de' ? 'Vorbestellung für' : 'Pre-order for',
      minutes: lang === 'de' ? 'Minuten' : 'Minutes',
      rejected: lang === 'de' ? 'Abgelehnt' : 'Rejected',
      scanQr: lang === 'de' ? 'QR-Code scannen für Navigation' : 'Scan for navigation',
      deliveredBy: lang === 'de' ? 'Geliefert von' : 'Delivered by',
      pickedUp: lang === 'de' ? 'Abgeholt' : 'Picked up',
      tableOrder: lang === 'de' ? 'Tischbestellung' : 'Table order',
      tableNotPaid: lang === 'de' ? 'Noch nicht bezahlt' : 'Not yet paid',
      payAtCounter: lang === 'de' ? 'An der Kasse bezahlen' : 'Pay at cashier',
      payWithWaiter: lang === 'de' ? 'Beim Service bezahlen' : 'Pay with waiter',
    };

    const printedOrderLabel = getOrderPrimaryLabel(order, labels.orderLabel);
    const printedTableLabel = getTableLabel(order, lang === 'de' ? 'Tisch' : 'Table');
    const dineInOrder = isDineInOrder(order);

    const tablePaymentMethod = String(order.payment_method || '').trim().toLowerCase();
    const tablePaymentPending =
      tablePaymentMethod === 'fuo_table_counter' ||
      tablePaymentMethod === 'fuo_table_waiter' ||
      tablePaymentMethod.includes('cashier') ||
      tablePaymentMethod.includes('counter') ||
      tablePaymentMethod.includes('kasse') ||
      tablePaymentMethod.includes('waiter') ||
      tablePaymentMethod.includes('service') ||
      tablePaymentMethod.includes('pay later') ||
      tablePaymentMethod.includes('bar') ||
      tablePaymentMethod.includes('cash');

    const tablePaymentLabel =
      tablePaymentMethod === 'fuo_table_counter' ||
      tablePaymentMethod.includes('cashier') ||
      tablePaymentMethod.includes('counter') ||
      tablePaymentMethod.includes('kasse')
        ? labels.payAtCounter
        : tablePaymentMethod === 'fuo_table_waiter' ||
          tablePaymentMethod.includes('waiter') ||
          tablePaymentMethod.includes('service') ||
          tablePaymentMethod.includes('pay later')
        ? labels.payWithWaiter
        : tablePaymentMethod.includes('bar') || tablePaymentMethod.includes('cash')
        ? (lang === 'de' ? 'Barzahlung' : 'Cash')
        : tablePaymentMethod.includes('online') || tablePaymentMethod.includes('card')
        ? 'Online'
        : (order.payment_method || '-');

    const inferredScheduledStr = (() => {
  if (order.orderable_order_date && order.orderable_order_time) {
    const isAsap = order.orderable_order_time.toLowerCase().includes('as soon as possible') ||
                   order.orderable_order_time.toLowerCase().includes('asap') ||
                   order.orderable_order_time.includes('(');
    if (!isAsap) {
      const rawTime = order.orderable_order_time.replace(/\s*\(.*?\)\s*/g, '').trim();
      return `${rawTime} — ${order.orderable_order_date}`;
    }
  }
  return null;
})();

const resolvedScheduledStr = scheduledTimeStr || inferredScheduledStr;
const resolvedMinutes = resolvedScheduledStr ? undefined : acceptedMinutes;

const acceptanceHtml = resolvedScheduledStr ? `
      <div style="border-top:1.5px solid #000; margin:12px 0;"></div>
      <p style="text-align:center; font-size:16px; color:#333; margin:4px 0;">${labels.preOrderFor}:</p>
      <p style="text-align:center; font-size:20px; font-weight:900; margin:2px 0;">${resolvedScheduledStr}</p>
    ` : resolvedMinutes ? `
      <div style="border-top:1.5px solid #000; margin:12px 0;"></div>
      <p style="text-align:center; font-size:16px; color:#333; margin:4px 0;">${labels.acceptedFor}:</p>
      <p style="text-align:center; font-size:20px; font-weight:900; margin:2px 0;">${resolvedMinutes} ${labels.minutes}</p>
    ` : rejected ? `
      <div style="border-top:1.5px solid #000; margin:12px 0;"></div>
      <p style="text-align:left; font-size:16px; color:#333; margin:4px 0;">${labels.rejected}:</p>
      ${rejectionReason ? `<p style="text-align:left; font-size:18px; margin:2px 0;">${rejectionReason}</p>` : ''}
    ` : '';

    const tableOrderHtml = `
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; font-size: 13px; margin: 0; padding: 10px; width: 280px; }
            * { -webkit-print-color-adjust: exact; }
            @page { margin: 0; size: 80mm auto; }
            .divider { border-top: 1px solid #000; margin: 9px 0; }
            .divider-dashed { border-top: 1px dashed #000; margin: 9px 0; }
            table { width: 100%; border-collapse: collapse; }
            td { font-size: 13px; vertical-align: top; }
            .table-kicker { text-align:center; font-size:12px; font-weight:800; letter-spacing:1.4px; text-transform:uppercase; margin:2px 0 3px; }
            .table-title { text-align:center; font-size:31px; line-height:1; font-weight:900; margin:4px 0 5px; }
            .qr-title { text-align:center; font-size:22px; line-height:1.1; font-weight:900; margin:0 0 8px; }
            .meta-row { font-size:14px; margin:3px 0; }
            .payment-box { border:2px solid #000; padding:8px 9px; margin:10px 0; text-align:center; }
            .payment-label { font-size:12px; font-weight:800; letter-spacing:1px; text-transform:uppercase; margin-bottom:3px; }
            .payment-method { font-size:19px; font-weight:900; line-height:1.15; }
            .payment-state { font-size:15px; font-weight:800; margin-top:4px; }
          </style>
        </head>
        <body>
          ${logoHtml}

          <div class="table-kicker">${labels.tableOrder}</div>
          <div class="table-title">${printedTableLabel || labels.tableOrder}</div>
          <div class="qr-title">${printedOrderLabel}</div>

          <div class="divider"></div>
          <p class="meta-row">${labels.createTime}: <span style="float:right; font-weight:700;">${createdTimeStr}&nbsp;&nbsp;${createdDateStr}</span></p>
          <div class="divider"></div>

          <table>${itemsHtml}</table>

          <div class="divider"></div>
          <table>
            ${(() => {
              const itemsSum = (order.items || []).reduce((sum: number, item: any) => sum + parseFloat(String(item.total || '0')), 0);
              const tip = parseFloat(String(order.total || '0')) - itemsSum;
              if (tip > 0.01) {
                return `<tr><td colspan="2" style="text-align:right; font-size:16px; color:#333;">${lang === 'de' ? 'Trinkgeld' : 'Tip'}:&nbsp;&nbsp;${order.currency} ${tip.toFixed(2)}</td></tr>`;
              }
              return '';
            })()}
            <tr>
              <td colspan="2" style="text-align:right; font-size:21px; font-weight:900;">${labels.total}:&nbsp;&nbsp;${order.currency} ${parseFloat(String(order.total || '0')).toFixed(2)}</td>
            </tr>
          </table>

          <div class="payment-box">
            <div class="payment-label">${labels.paymentMode}</div>
            <div class="payment-method">${tablePaymentLabel}</div>
            <div class="payment-state">${tablePaymentPending ? labels.tableNotPaid : labels.paid}</div>
          </div>

          ${order.note ? `<div class="divider-dashed"></div><p style="font-size:18px;"><strong>${labels.note}:</strong> ${order.note}</p>` : ''}
          ${acceptanceHtml}

          <div style="border-top:1px dashed #000; margin:12px 0;"></div>
          <p style="text-align:center; font-size:12px; color:#000000; margin:4px 0;">Powered by: foodup.ch</p>
        </body>
      </html>
    `;

    const normalOrderHtml = `
      <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: Arial, sans-serif; font-size: 13px; margin: 0; padding: 10px; width: 280px; } * { -webkit-print-color-adjust: exact; } @page { margin: 0; size: 80mm auto; }
            .center { text-align: center; margin: 2px 0; }
            .divider { border-top: 1px solid #000; margin: 8px 0; }
            .divider-dashed { border-top: 1px dashed #000; margin: 8px 0; }
            table { width: 100%; border-collapse: collapse; }
            td { font-size: 13px; vertical-align: top; }
          </style>
        </head>
        <body>
          ${logoHtml}
          <h2 style="text-align:center; font-size:22px; font-weight:900; margin:6px 0 4px 0; letter-spacing:0;">${printedOrderLabel}</h2>
          <p style="font-size:16px; color:#333; margin:2px 0;">${labels.createTime}: <span style="float:right;">${createdTimeStr}&nbsp;&nbsp;${createdDateStr}</span></p>
          <div class="divider"></div>
          <p style="text-align:center; font-size:17px; font-weight:bold; margin:2px 0; text-transform:uppercase; letter-spacing:1px;">${labels.requestedFor}:</p>
          <p style="text-align:center; font-size:22px; font-weight:900; margin:4px 0;">${requestedStr}</p>
          <div class="divider"></div>
          <table style="margin-bottom:6px;">
            <tr>
              <td style="width:50%;">
                <div style="font-size:15px; font-weight:bold; text-transform:uppercase; white-space:nowrap;">${labels.shipmentMethod}:</div>
                <div style="font-size:22px; font-weight:900; margin-top:2px;">${
                  order.shipping_method === 'Lieferung' ? (lang === 'de' ? 'Lieferung' : 'Delivery') :
                  order.shipping_method === 'Abholung' ? (lang === 'de' ? 'Abholung' : 'Pickup') :
                  isDineInOrder(order) ? (printedTableLabel || (lang === 'de' ? 'Am Tisch' : 'Dine in')) :
                  order.shipping_method || '-'
                }</div>
              </td>
              <td style="width:50%; text-align:right;">
                <div style="font-size:15px; font-weight:bold; text-transform:uppercase;">${labels.paymentMode}:</div>
                <div style="font-size:22px; font-weight:900; margin-top:2px; text-align:right;">${
                  order.payment_method?.toLowerCase().includes('bar') || order.payment_method?.toLowerCase().includes('cash')
                    ? (lang === 'de' ? 'Barzahlung' : 'Cash')
                    : order.payment_method?.toLowerCase().includes('online') || order.payment_method?.toLowerCase().includes('card')
                    ? (lang === 'de' ? 'Online' : 'Online')
                    : order.payment_method || '-'
                }</div>
              </td>
            </tr>
          </table>
          <div class="divider"></div>
          <p style="margin:4px 0; font-size:22px; font-weight:bold;">${order.customer_name || ''}</p>
          ${order.shipping_address ? `${(() => {
            const parts = order.shipping_address.split(',').map((s: string) => s.trim());
            let street = '';
            let zipCity = '';
            if (parts.length >= 3) {
              street = parts[0].replace(/\s+\d+[a-zA-Z]?$/, '').trim();
              zipCity = parts[2] + ' ' + parts[1];
            } else if (parts.length === 2) {
              street = parts[0].replace(/\s+\d+[a-zA-Z]?$/, '').trim();
              zipCity = parts[1];
            } else {
              street = order.shipping_address;
            }
            return `<p style="margin:4px 0; font-size:20px;">${street}</p>${zipCity ? `<p style="margin:4px 0; font-size:20px;">${zipCity}</p>` : ''}`;
          })()}` : ''}
          <div class="divider"></div>
          <table>${itemsHtml}</table>
          <div class="divider"></div>
          <table>
            ${(() => {
              const itemsSum = (order.items || []).reduce((sum: number, item: any) => sum + parseFloat(String(item.total || '0')), 0);
              const tip = parseFloat(String(order.total || '0')) - itemsSum;
              if (tip > 0.01) {
                return `<tr><td colspan="2" style="text-align:right; font-size:16px; color:#333;">${lang === 'de' ? 'Trinkgeld' : 'Tip'}:&nbsp;&nbsp;${order.currency} ${tip.toFixed(2)}</td></tr>`;
              }
              return '';
            })()}
            <tr>
              <td colspan="2" style="text-align:right; font-size:18px; font-weight:bold;">${labels.total}:&nbsp;&nbsp;${order.currency} ${parseFloat(String(order.total || '0')).toFixed(2)}</td>
            </tr>
          </table>
          <div class="divider"></div>
          <p style="text-align:center; font-size:20px; font-weight:900; margin:8px 0; line-height:1.2;">${isPaid ? labels.paid : labels.notPaid}</p>
          ${order.note ? `<div class="divider-dashed"></div><p style="font-size:18px;"><strong>${labels.note}:</strong> ${order.note}</p>` : ''}
          ${acceptanceHtml}
          ${deliveredBy ? `
            <div style="border-top:1.5px solid #000; margin:12px 0;"></div>
            <p style="text-align:center; font-size:16px; color:#333; margin:4px 0;">
              ${deliveredBy === '__pickup__' || deliveredBy === 'Abgeholt' || deliveredBy === 'Picked Up'
                ? `✓ ${labels.pickedUp}`
                : `✓ ${labels.deliveredBy}: ${deliveredBy}`
              }
            </p>
          ` : ''}
          ${order.shipping_address ? `
          <div style="border-top:1px dashed #000; margin:12px 0;"></div>
          <div style="text-align:center; margin:8px 0;">
            <img src="https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent('FOODUP:' + order.order_id)}" width="180" height="180" />
          </div>
          
          ` : ''}
          <div style="border-top:1px dashed #000; margin:12px 0;"></div>
          <p style="text-align:center; font-size:12px; color:#000000; margin:4px 0;">Powered by: foodup.ch</p>
        </body>
      </html>
    `;

    const html = dineInOrder ? tableOrderHtml : normalOrderHtml;

    const printTimeout = new Promise<void>((_, reject) =>
      setTimeout(() => reject(new Error('Print timeout after 60s')), 60000)
    );
    try {
      await Promise.race([Print.printAsync({ html, width: 280 }), printTimeout]);
      console.log(`[print] completed for order ${order?.order_id}`);
    } catch (printError: any) {
      console.log(`[print] failed or timed out for order ${order?.order_id}:`, printError?.message || String(printError));
    } finally {
      isPrinting = false;
      console.log(`[print] lock released for order ${order?.order_id}`);
    }
    return true;

  } catch (e: any) {
    console.log(`[print] outer error for order ${order?.order_id}:`, e?.message || String(e));
    isPrinting = false;
    return false;
  }
}