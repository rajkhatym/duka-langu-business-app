import AsyncStorage from '@react-native-async-storage/async-storage';

import type { Product, Sale } from '@/types/database';

const LOCAL_REPORT_SALES_KEY = 'godown.report-sales.v1';

type LocalReportSale = Sale & {
  id: string;
  products?: Pick<Product, 'id' | 'name' | 'unit' | 'sku' | 'cost_price' | 'warranty_months'> | null;
};

async function readLocalReportSales() {
  const raw = await AsyncStorage.getItem(LOCAL_REPORT_SALES_KEY);
  if (!raw) return [] as LocalReportSale[];

  try {
    const parsed = JSON.parse(raw) as LocalReportSale[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function writeLocalReportSales(rows: LocalReportSale[]) {
  await AsyncStorage.setItem(LOCAL_REPORT_SALES_KEY, JSON.stringify(rows.slice(0, 500)));
}

export async function recordLocalReportSales(
  rows: {
    branch_id?: string | null;
    product: Product;
    quantity: number;
    unit_price: number;
    amount_paid: number;
    customer_name: string | null;
    payment_status: Sale['payment_status'];
    payment_method?: Sale['payment_method'];
    note: string | null;
    created_by: string | null;
  }[]
) {
  const createdAt = new Date().toISOString();
  const existing = await readLocalReportSales();
  const nextRows: LocalReportSale[] = rows.map((row, index) => ({
    id: `local-${Date.now()}-${index}`,
    branch_id: row.branch_id,
    product_id: row.product.id,
    quantity: row.quantity,
    unit_price: row.unit_price,
    amount_paid: row.amount_paid,
    customer_name: row.customer_name,
    payment_status: row.payment_status,
    payment_method: row.payment_method,
    note: row.note,
    created_by: row.created_by,
    created_at: createdAt,
    products: {
      id: row.product.id,
      name: row.product.name,
      unit: row.product.unit,
      sku: row.product.sku,
      cost_price: row.product.cost_price,
      warranty_months: row.product.warranty_months,
    },
  }));

  await writeLocalReportSales([...nextRows, ...existing]);
  return nextRows.map((row) => row.id);
}

export async function removeLocalReportSales(ids: string[]) {
  if (ids.length === 0) return;
  const rows = await readLocalReportSales();
  await writeLocalReportSales(rows.filter((row) => !ids.includes(row.id)));
}

export async function getLocalReportSales(from: Date, branchId?: string | null) {
  const rows = await readLocalReportSales();
  return rows.filter((row) => {
    if (new Date(row.created_at) < from) return false;
    if (branchId && row.branch_id !== branchId) return false;
    return true;
  });
}
