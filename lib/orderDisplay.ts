export function getQrOrderNumber(order: any): number | null {
  const value = Number(order?.qr_order_number || 0);
  return Number.isFinite(value) && value >= 100 ? Math.trunc(value) : null;
}

/** True for orders placed on a FoodUp Kiosk (source "kiosk" or a kiosk device id). */
export function isKioskOrder(order: any): boolean {
  return (
    String(order?.source || '').trim().toLowerCase() === 'kiosk' ||
    Boolean(String(order?.kiosk_device || '').trim())
  );
}

function parseBoolean(value: any): boolean | undefined {
  if (value === true || value === 1) return true;
  if (value === false || value === 0) return false;
  const text = String(value ?? '').trim().toLowerCase();
  if (text === 'true' || text === '1' || text === 'yes') return true;
  if (text === 'false' || text === '0' || text === 'no') return false;
  return undefined;
}

/**
 * Kiosk fields of a backend order or push payload. Only fields that are present
 * are returned, so spreading the result never wipes a value that is already known.
 */
export function kioskFieldsFrom(source: any): {
  paid?: boolean;
  payment_status?: string;
  payment_method_id?: string;
  kiosk_device?: string;
  kiosk_name?: string;
} {
  const result: {
    paid?: boolean;
    payment_status?: string;
    payment_method_id?: string;
    kiosk_device?: string;
    kiosk_name?: string;
  } = {};
  const paid = parseBoolean(source?.paid);
  if (paid !== undefined) result.paid = paid;
  for (const key of ['payment_status', 'payment_method_id', 'kiosk_device', 'kiosk_name'] as const) {
    const value = String(source?.[key] ?? '').trim();
    if (value) result[key] = value;
  }
  return result;
}

/**
 * Paid state sent by the website (kiosk orders): true / false, or null when the
 * order carries no information and the payment method text has to decide.
 */
export function getExplicitPaidState(order: any): boolean | null {
  const paid = parseBoolean(order?.paid);
  if (paid !== undefined) return paid;
  const status = String(order?.payment_status || '').trim().toLowerCase();
  if (status === 'paid') return true;
  if (status === 'unpaid' || status === 'pending') return false;
  return null;
}

/** "Hier essen" / "Mitnehmen" (or English) for a kiosk order. */
export function getKioskServiceLabel(order: any, lang: string = 'de'): string {
  const dineIn = (() => {
    const type = String(order?.fulfillment_type || order?.order_type || '').trim().toLowerCase().replace(/-/g, '_');
    return type === 'dine_in';
  })();
  if (lang === 'de') return dineIn ? 'Hier essen' : 'Mitnehmen';
  return dineIn ? 'Eat in' : 'Takeaway';
}

export function isDineInOrder(order: any): boolean {
  // Kiosk orders follow the same simple lifecycle as table orders:
  // Received -> Accepted -> Preparing -> Ready. There is no table session to close.
  if (isKioskOrder(order)) return true;
  const fulfillment = String(order?.fulfillment_type || order?.order_type || '')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');

  return (
    fulfillment === 'dine_in' ||
    fulfillment === 'table' ||
    Boolean(String(order?.table_session_id || '').trim())
  );
}

export function getOrderPrimaryLabel(order: any, normalLabel = 'Order'): string {
  const qrNumber = getQrOrderNumber(order);
  if (qrNumber !== null) return `${isKioskOrder(order) ? 'Kiosk' : 'QR'} #${qrNumber}`;
  return `${normalLabel} #${order?.order_id ?? ''}`.trim();
}

export function getTableLabel(order: any, tableWord = 'Table'): string {
  if (isKioskOrder(order)) {
    return getKioskServiceLabel(order, tableWord.toLowerCase() === 'table' ? 'en' : 'de');
  }
  const tableName = String(order?.table_name || '').trim();
  const tableNumber = String(order?.table_number || '').trim();

  if (tableName) {
    if (/^table\s+/i.test(tableName)) {
      return tableName.replace(/^table\s+/i, `${tableWord} `);
    }
    return tableName;
  }

  return tableNumber ? `${tableWord} ${tableNumber}` : '';
}

export function getQrOrderContextLabel(order: any, tableWord = 'Table'): string {
  const qrNumber = getQrOrderNumber(order);
  if (qrNumber === null) return '';
  if (isKioskOrder(order)) {
    return `Kiosk #${qrNumber} · ${getKioskServiceLabel(order, tableWord.toLowerCase() === 'table' ? 'en' : 'de')}`;
  }
  const tableLabel = getTableLabel(order, tableWord);
  return `QR #${qrNumber}${tableLabel ? ` · ${tableLabel}` : ''}`;
}
