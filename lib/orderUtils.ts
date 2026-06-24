// Minimal shape required by isScheduledOrder — avoids importing from index.tsx
export interface ScheduledOrderFields {
  orderable_order_time?: string;
}

type TFunction = { today: string; yesterday: string; [key: string]: string };

export function isPickupMethod(method?: string): boolean {
  const m = (method || '').toLowerCase().trim();
  return (
    m.includes('abholung') ||
    m.includes('abholen') ||
    m.includes('selbstabholung') ||
    m.includes('pickup') ||
    m.includes('pick up') ||
    m.includes('local_pickup') ||
    m.includes('local pickup') ||
    m.includes('orderable_pickup') ||
    m.includes('takeaway') ||
    m.includes('take away')
  );
}

export function isScheduledOrder(o: ScheduledOrderFields): boolean {
  return (
    !!o.orderable_order_time &&
    o.orderable_order_time.trim() !== '' &&
    !o.orderable_order_time.toLowerCase().includes('as soon as possible') &&
    !o.orderable_order_time.toLowerCase().includes('asap') &&
    !o.orderable_order_time.includes('(')
  );
}

export function getDateLabel(timestamp: number, t: TFunction): string {
  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return t.today;
  if (date.toDateString() === yesterday.toDateString()) return t.yesterday;
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

export function groupOrdersByDate<T extends { timestamp: number }>(
  orders: T[],
  t: TFunction
): { title: string; data: T[] }[] {
  const groups: { [key: string]: T[] } = {};
  orders.forEach(order => {
    const label = getDateLabel(order.timestamp, t);
    if (!groups[label]) groups[label] = [];
    groups[label].push(order);
  });
  return Object.keys(groups).map(title => ({ title, data: groups[title] }));
}

export function isOlderThanToday(timestamp: number): boolean {
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  return new Date(timestamp) < todayStart;
}

export function isTodayBeforeThreeAM(timestamp: number): boolean {
  const date = new Date(timestamp);
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const cutoff = new Date();
  cutoff.setHours(3, 0, 0, 0);
  return date >= todayStart && date < cutoff;
}