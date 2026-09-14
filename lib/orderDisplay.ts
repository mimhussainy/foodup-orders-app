export function getQrOrderNumber(order: any): number | null {
  const value = Number(order?.qr_order_number || 0);
  return Number.isFinite(value) && value >= 100 ? Math.trunc(value) : null;
}

export function isDineInOrder(order: any): boolean {
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
  if (qrNumber !== null) return `QR #${qrNumber}`;
  return `${normalLabel} #${order?.order_id ?? ''}`.trim();
}

export function getTableLabel(order: any, tableWord = 'Table'): string {
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
  const tableLabel = getTableLabel(order, tableWord);
  return `QR #${qrNumber}${tableLabel ? ` · ${tableLabel}` : ''}`;
}
