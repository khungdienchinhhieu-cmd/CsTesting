import { decodeReplay, type ReplayData } from '@tactical/shared';

export interface SavedReplay {
  id: string;
  savedAt: number;
  mapId: string;
  mode: string;
  score: string;
  bytes: number;
  data: string;
}

const KEY = 'tactical.replays.v1';
const MAX_ITEMS = 3;
const MAX_BYTES = 2_000_000;

/** Lưu replay cục bộ (localStorage), giới hạn 3 trận gần nhất để không đầy quota. */
export class ReplayStore {
  list(): SavedReplay[] {
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return [];
      const arr = JSON.parse(raw) as unknown;
      if (!Array.isArray(arr)) return [];
      return arr.filter((x): x is SavedReplay => typeof x === 'object' && x !== null
        && typeof (x as SavedReplay).id === 'string' && typeof (x as SavedReplay).data === 'string');
    } catch { return []; }
  }

  save(json: string): SavedReplay | null {
    if (json.length > MAX_BYTES) return null;
    let data: ReplayData;
    try { data = decodeReplay(json); } catch { return null; }
    const item: SavedReplay = {
      id: `${data.meta.createdAt}_${Math.random().toString(36).slice(2, 6)}`,
      savedAt: Date.now(),
      mapId: data.meta.mapId,
      mode: data.meta.mode,
      score: `0:0`,
      bytes: json.length,
      data: json,
    };
    const items = [item, ...this.list()].slice(0, MAX_ITEMS);
    if (!this.write(items)) return null;
    return item;
  }

  remove(id: string): void {
    this.write(this.list().filter((x) => x.id !== id));
  }

  private write(items: SavedReplay[]): boolean {
    try { localStorage.setItem(KEY, JSON.stringify(items)); return true; }
    catch {
      try { localStorage.setItem(KEY, JSON.stringify(items.slice(0, 1))); return items.length <= 1; }
      catch { return false; }
    }
  }
}
