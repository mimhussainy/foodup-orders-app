export function formatPhone(phone: string): string {
  if (!phone) return phone;
  let p = phone.replace(/\s+/g, '').replace(/[^0-9+]/g, '');
  if (p.startsWith('+41')) p = '0' + p.slice(3);
  else if (p.startsWith('41')) p = '0' + p.slice(2);
  if (p.length === 10) p = p.slice(0,3) + ' ' + p.slice(3,6) + ' ' + p.slice(6,8) + ' ' + p.slice(8,10);
  return p;
}

export function formatAddress(address: string): string {
  if (!address) return address;
  const parts = address.split(',').map(p => p.trim());
  if (parts.length === 3) return `${parts[0]}, ${parts[2]} ${parts[1]}`;
  return address;
}