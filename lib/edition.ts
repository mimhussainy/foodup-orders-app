import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useState } from 'react';

// FoodUp edition (Free / Pro).
//
// Safety rules (16.10.2026 incident):
// - The app NEVER asks a dedicated endpoint. The edition only arrives as an
//   extra `edition` field in responses the app already receives
//   (login, heartbeat, auto-settings).
// - Only an explicit "free" switches to Free. A missing field, an older
//   backend, a network error or anything unexpected changes nothing.
// - Nothing here can block, hide or delay order reception, accept/reject or
//   printing. Free only locks Pro screens (statistics, couriers, history).

export type FoodUpEdition = 'free' | 'pro';

const STORAGE_KEY = 'foodup_edition';

let current: FoodUpEdition = 'pro';
const listeners = new Set<(edition: FoodUpEdition) => void>();

function setCurrent(next: FoodUpEdition) {
  if (next === current) return;
  current = next;
  listeners.forEach(listener => {
    try { listener(next); } catch (_) {}
  });
}

export function getEdition(): FoodUpEdition {
  return current;
}

/** Local read only (no network). Call once at app start. */
export async function loadStoredEdition(): Promise<FoodUpEdition> {
  try {
    const stored = await AsyncStorage.getItem(STORAGE_KEY);
    setCurrent(stored === 'free' ? 'free' : 'pro');
  } catch (_) {}
  return current;
}

/**
 * Apply the `edition` field of a backend response. Responses without a valid
 * field (older backend, errors) are ignored, so the current edition stays.
 */
export function applyEditionFromResponse(result: any): void {
  const value = result && typeof result === 'object' ? result.edition : undefined;
  if (value !== 'free' && value !== 'pro') return;
  setCurrent(value);
  AsyncStorage.setItem(STORAGE_KEY, value).catch(() => {});
}

/** On logout: the next restaurant starts as Pro until told otherwise. */
export async function clearStoredEdition(): Promise<void> {
  setCurrent('pro');
  try { await AsyncStorage.removeItem(STORAGE_KEY); } catch (_) {}
}

export function useEdition(): FoodUpEdition {
  const [edition, setEdition] = useState<FoodUpEdition>(current);
  useEffect(() => {
    listeners.add(setEdition);
    setEdition(current);
    return () => { listeners.delete(setEdition); };
  }, []);
  return edition;
}

export function useIsFree(): boolean {
  return useEdition() === 'free';
}
