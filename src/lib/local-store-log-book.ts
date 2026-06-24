import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Product, StoreLogBookEntry } from '@/types/database';

const LOCAL_STORE_LOG_BOOK_KEY = 'godown.store-log-book.v1';

type LocalStoreLogBookEntry = StoreLogBookEntry;

async function readLocalStoreLogBookEntries() {
  const raw = await AsyncStorage.getItem(LOCAL_STORE_LOG_BOOK_KEY);
  if (!raw) return [] as LocalStoreLogBookEntry[];

  try {
    const parsed = JSON.parse(raw) as LocalStoreLogBookEntry[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeLocalStoreLogBookEntries(rows: LocalStoreLogBookEntry[]) {
  await AsyncStorage.setItem(LOCAL_STORE_LOG_BOOK_KEY, JSON.stringify(rows.slice(0, 500)));
}

export async function recordLocalStoreLogBookEntry(row: {
  branch_id?: string | null;
  movement_type: NonNullable<StoreLogBookEntry['movement_type']>;
  person_name: string;
  product: Product;
  quantity: number;
  note: string | null;
  created_by: string | null;
}) {
  const existing = await readLocalStoreLogBookEntries();
  const entry: LocalStoreLogBookEntry = {
    id: `local-store-log-${Date.now()}`,
    branch_id: row.branch_id,
    movement_type: row.movement_type,
    status: 'pending',
    person_name: row.person_name,
    product_id: row.product.id,
    product_name: row.product.name,
    quantity: row.quantity,
    unit: row.product.unit,
    note: row.note,
    approved_by: null,
    approved_at: null,
    approval_note: null,
    created_by: row.created_by,
    created_at: new Date().toISOString(),
    products: {
      id: row.product.id,
      name: row.product.name,
      unit: row.product.unit,
      sku: row.product.sku,
    },
    profiles: null,
  };

  await writeLocalStoreLogBookEntries([entry, ...existing]);
  return entry.id;
}

export async function updateLocalStoreLogBookApproval(row: {
  id: string;
  status: 'approved' | 'rejected';
  approved_by: string | null;
  approval_note?: string | null;
}) {
  const rows = await readLocalStoreLogBookEntries();
  await writeLocalStoreLogBookEntries(
    rows.map((entry) =>
      entry.id === row.id
        ? {
            ...entry,
            status: row.status,
            approved_by: row.approved_by,
            approved_at: new Date().toISOString(),
            approval_note: row.approval_note ?? null,
          }
        : entry
    )
  );
}

export async function getLocalStoreLogBookEntries(branchId?: string | null) {
  const rows = await readLocalStoreLogBookEntries();
  return rows.filter((row) => {
    if (branchId && row.branch_id !== branchId) return false;
    return true;
  });
}
