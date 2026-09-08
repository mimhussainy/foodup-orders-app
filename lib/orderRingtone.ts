import { Audio } from 'expo-av';

export type OrderRingtoneKey = { restaurantCode: string; orderId: number };
export const orderRingtoneKey = (restaurantCode: string, orderId: number): OrderRingtoneKey => ({
  restaurantCode: String(restaurantCode || '').toLowerCase().trim(), orderId: Number(orderId),
});
export const ringtoneKeyId = (key: OrderRingtoneKey): string => JSON.stringify([key.restaurantCode.toLowerCase().trim(), key.orderId]);
export const sameRingtoneKey = (a: OrderRingtoneKey | null, b: OrderRingtoneKey): boolean => !!a && ringtoneKeyId(a) === ringtoneKeyId(b);

type SoundRecord = { key: OrderRingtoneKey; sound: Audio.Sound; safe: boolean; unloaded: boolean; playPending: boolean; cleanup?: Promise<boolean> };
let restaurant = '';
let generation = 0;
let owner: OrderRingtoneKey | null = null;
let loading: Promise<void> = Promise.resolve();
const records = new Set<SoundRecord>();
const suppressed = new Set<string>();
const resolved = new Set<string>();
const resolutionListeners = new Set<(key: OrderRingtoneKey) => void>();
const failureListeners = new Set<(key: OrderRingtoneKey) => void>();

// Invoke native stop immediately, never behind create/play promises. Keep failed
// cleanup records so future starts/stops can retry instead of creating two loops.
function cleanup(record: SoundRecord): Promise<boolean> {
  if (record.cleanup) return record.cleanup;
  const task = (async () => {
    try { await record.sound.stopAsync(); record.safe = true; }
    catch (error) { console.warn('[order-ringtone] stop failed', error); }
    try { await record.sound.unloadAsync(); record.safe = true; record.unloaded = true; }
    catch (error) { console.warn('[order-ringtone] unload failed', error); }
    if (record.unloaded) records.delete(record);
    return record.safe && (!record.playPending || record.unloaded);
  })();
  record.cleanup = task;
  void task.finally(() => { record.cleanup = undefined; });
  return task;
}

export function selectOrderRingtoneRestaurant(code: string): void {
  const normalized = String(code || '').toLowerCase().trim();
  if (restaurant === normalized) return;
  restaurant = normalized;
  void stopAllOrderRingtone();
}
export const isOrderRingtoneSuppressed = (key: OrderRingtoneKey): boolean => suppressed.has(ringtoneKeyId(key));
export const isOrderRingtoneResolved = (key: OrderRingtoneKey): boolean => resolved.has(ringtoneKeyId(key));

export function startOrderRingtone(input: OrderRingtoneKey, uri: string): Promise<void> {
  const key = orderRingtoneKey(input.restaurantCode, input.orderId);
  if (!key.restaurantCode || key.restaurantCode !== restaurant || !Number.isFinite(key.orderId) || key.orderId <= 0 || !uri || isOrderRingtoneSuppressed(key) || isOrderRingtoneResolved(key)) return Promise.resolve();
  if (sameRingtoneKey(owner, key)) return loading;
  const token = ++generation;
  owner = key;
  const existing = [...records];
  const disposals = existing.map(cleanup);
  const valid = () => token === generation && restaurant === key.restaurantCode && sameRingtoneKey(owner, key) && !isOrderRingtoneSuppressed(key) && !isOrderRingtoneResolved(key);
  // Serialize creation, but never await playAsync in this lane.
  loading = loading.then(async () => {
    const previousSafe = await Promise.all(disposals);
    if (!valid()) return;
    if (previousSafe.some(value => !value)) { owner = null; return; }
    const safe = await Promise.all([...records].filter(record => !existing.includes(record)).map(cleanup));
    if (!valid()) return;
    if (safe.some(value => !value)) { owner = null; return; }
    try {
      const { sound } = await Audio.Sound.createAsync({ uri }, { isLooping: true, shouldPlay: false });
      const record: SoundRecord = { key, sound, safe: false, unloaded: false, playPending: false };
      records.add(record);
      if (!valid()) { await cleanup(record); return; }
      record.playPending = true;
      void sound.playAsync().catch(error => {
        console.warn('[order-ringtone] play failed', error);
        if (valid()) owner = null;
      }).finally(() => {
        record.playPending = false;
        if (!valid()) {
          // If unload failed, a late native play completion needs fresh cleanup.
          if (!record.unloaded) record.safe = false;
          void cleanup(record);
        }
      });
    } catch (error) {
      console.warn('[order-ringtone] load failed', error);
      if (valid()) owner = null;
    }
  }).catch(error => { console.warn('[order-ringtone]', error); });
  return loading;
}

export function stopOrderRingtone(key?: OrderRingtoneKey): Promise<void> {
  const matchesOwner = !key || sameRingtoneKey(owner, key);
  if (matchesOwner) {
    ++generation;
    owner = null;
  }
  const targets = [...records].filter(record => !key || sameRingtoneKey(record.key, key));
  const now = Promise.all(targets.map(cleanup));
  const pending = matchesOwner ? loading : Promise.resolve();
  return Promise.all([now, pending]).then(() => undefined);
}
export const stopAllOrderRingtone = (): Promise<void> => stopOrderRingtone();
export function suppressOrderRingtone(key: OrderRingtoneKey): Promise<void> {
  suppressed.add(ringtoneKeyId(key));
  return stopOrderRingtone(key);
}
export function releaseOrderRingtoneSuppression(key: OrderRingtoneKey): void {
  suppressed.delete(ringtoneKeyId(key));
  for (const listener of failureListeners) listener(key);
}
// Local success marks state only; existing onClose remains responsible for UI timing.
export function markOrderRingtoneResolved(key: OrderRingtoneKey): void {
  resolved.add(ringtoneKeyId(key));
  void stopOrderRingtone(key);
}
export function resolveOrderRingtone(key: OrderRingtoneKey): void {
  markOrderRingtoneResolved(key);
  for (const listener of resolutionListeners) listener(key);
}
export function subscribeOrderRingtoneResolution(listener: (key: OrderRingtoneKey) => void): () => void {
  resolutionListeners.add(listener);
  return () => { resolutionListeners.delete(listener); };
}
export function subscribeOrderRingtoneFailure(listener: (key: OrderRingtoneKey) => void): () => void {
  failureListeners.add(listener);
  return () => { failureListeners.delete(listener); };
}
