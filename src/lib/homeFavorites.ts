export const SLOT_COUNT = 5;
const STORAGE_KEY = "home_favorites_v1";

export type FavoriteSlots = (string | null)[];

export const loadFavorites = (): FavoriteSlots => {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return Array(SLOT_COUNT).fill(null);
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return Array(SLOT_COUNT).fill(null);
    const out: FavoriteSlots = Array(SLOT_COUNT).fill(null);
    for (let i = 0; i < SLOT_COUNT; i++) {
      const v = parsed[i];
      out[i] = typeof v === "string" && v.length > 0 ? v : null;
    }
    return out;
  } catch {
    return Array(SLOT_COUNT).fill(null);
  }
};

export const saveFavorites = (slots: FavoriteSlots): void => {
  const normalized: FavoriteSlots = Array(SLOT_COUNT).fill(null);
  for (let i = 0; i < SLOT_COUNT; i++) {
    const v = slots[i];
    normalized[i] = typeof v === "string" && v.length > 0 ? v : null;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized));
};

export const setSlot = (index: number, checklistId: string | null): FavoriteSlots => {
  const slots = loadFavorites();
  if (index < 0 || index >= SLOT_COUNT) return slots;
  slots[index] = checklistId;
  saveFavorites(slots);
  return slots;
};

/**
 * Returns the next non-empty favorite checklist id after currentChecklistId,
 * wrapping around. Skips empty slots and skips the current id itself.
 * Returns null if no eligible target exists.
 */
export const nextFavoriteAfter = (currentChecklistId: string | null): string | null => {
  const slots = loadFavorites();
  const filled = slots.filter((s): s is string => !!s);
  if (filled.length === 0) return null;
  // If only one favorite is set, always return it (even if it equals current).
  if (filled.length === 1) return filled[0];

  const currentIdx = currentChecklistId ? slots.indexOf(currentChecklistId) : -1;
  const start = currentIdx >= 0 ? currentIdx + 1 : 0;
  for (let step = 0; step < SLOT_COUNT; step++) {
    const i = (start + step) % SLOT_COUNT;
    const v = slots[i];
    if (v && v !== currentChecklistId) return v;
  }
  return null;
};
