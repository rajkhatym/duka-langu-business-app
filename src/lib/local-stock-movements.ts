import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Product, StockMovement } from '@/types/database';

const LOCAL_STOCK_MOVEMENTS_KEY = 'godown.stock-movements.v1';

type LocalStockMovement = StockMovement & {
  products?: Pick<Product, 'id' | 'name' | 'unit' | 'sku'> | null;
};

async function readLocalStockMovements() {
  const raw = await AsyncStorage.getItem(LOCAL_STOCK_MOVEMENTS_KEY);
  if (!raw) return [] as LocalStockMovement[];

  try {
    const parsed = JSON.parse(raw) as LocalStockMovement[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeLocalStockMovements(rows: LocalStockMovement[]) {
  await AsyncStorage.setItem(LOCAL_STOCK_MOVEMENTS_KEY, JSON.stringify(rows.slice(0, 500)));
}

export async function recordLocalStockMovement(row: {
  branch_id?: string | null;
  product: Product;
  type: StockMovement['type'];
  quantity: number;
  note: string | null;
  created_by: string | null;
}) {
  const existing = await readLocalStockMovements();
  const movement: LocalStockMovement = {
    id: `local-movement-${Date.now()}`,
    branch_id: row.branch_id,
    product_id: row.product.id,
    type: row.type,
    quantity: row.quantity,
    note: row.note,
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

  await writeLocalStockMovements([movement, ...existing]);
  return movement.id;
}

export async function getLocalStockMovements(branchId?: string | null) {
  const rows = await readLocalStockMovements();
  return rows.filter((row) => {
    if (branchId && row.branch_id !== branchId) return false;
    return true;
  });
}

export async function removeLocalStockMovement(id: string) {
  const rows = await readLocalStockMovements();
  await writeLocalStockMovements(rows.filter((row) => row.id !== id));
}
