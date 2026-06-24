import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Product, Purchase } from '@/types/database';

const LOCAL_PURCHASES_KEY = 'godown.purchases.v1';

type LocalPurchase = Purchase & {
  products?: Pick<Product, 'id' | 'name' | 'unit' | 'sku'> | null;
};

async function readLocalPurchases() {
  const raw = await AsyncStorage.getItem(LOCAL_PURCHASES_KEY);
  if (!raw) return [] as LocalPurchase[];

  try {
    const parsed = JSON.parse(raw) as LocalPurchase[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeLocalPurchases(rows: LocalPurchase[]) {
  await AsyncStorage.setItem(LOCAL_PURCHASES_KEY, JSON.stringify(rows.slice(0, 500)));
}

export async function recordLocalPurchase(row: {
  branch_id?: string | null;
  supplier_name: string;
  invoice_number: string | null;
  product: Product;
  quantity: number;
  cost_price: number;
  amount_paid: number;
  payment_status: Purchase['payment_status'];
  note: string | null;
  created_by: string | null;
}) {
  const existing = await readLocalPurchases();
  const purchase: LocalPurchase = {
    id: `local-purchase-${Date.now()}`,
    branch_id: row.branch_id,
    supplier_name: row.supplier_name,
    invoice_number: row.invoice_number,
    product_id: row.product.id,
    quantity: row.quantity,
    cost_price: row.cost_price,
    amount_paid: row.amount_paid,
    payment_status: row.payment_status,
    note: row.note,
    created_by: row.created_by,
    created_at: new Date().toISOString(),
    products: {
      id: row.product.id,
      name: row.product.name,
      unit: row.product.unit,
      sku: row.product.sku,
    },
  };

  await writeLocalPurchases([purchase, ...existing]);
  return purchase.id;
}

export async function getLocalPurchases(branchId?: string | null) {
  const rows = await readLocalPurchases();
  return rows.filter((row) => {
    if (branchId && row.branch_id !== branchId) return false;
    return true;
  });
}
