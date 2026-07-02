export function parseWCDate(dateStr: string): Date | null {
  if (!dateStr) return null;
  const clean = dateStr.replace(' ', 'T');
  const match = clean.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):?(\d{2})?/);
  if (!match) return null;
  return new Date(
    parseInt(match[1]),
    parseInt(match[2]) - 1,
    parseInt(match[3]),
    parseInt(match[4]),
    parseInt(match[5]),
    parseInt(match[6] || '0')
  );
}

export function wcDateToMs(dateStr: string): number {
  if (!dateStr) return Date.now();
  const d = parseWCDate(dateStr);
  return d ? d.getTime() : Date.now();
}

export function formatDate(dateStr: string): string {
  if (!dateStr) return '';
  const d = parseWCDate(dateStr);
  if (!d) return dateStr;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${mins}`;
}

export function formatISODate(isoStr: string): string {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (isNaN(d.getTime())) return isoStr;
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  const hours = String(d.getHours()).padStart(2, '0');
  const mins = String(d.getMinutes()).padStart(2, '0');
  return `${day}/${month}/${year} ${hours}:${mins}`;
}