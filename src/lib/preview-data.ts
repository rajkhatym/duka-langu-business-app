import type {
  Debt,
  Expense,
  OperationCashAuditEvent,
  OperationCashInjection,
  Product,
  Purchase,
  Quotation,
  Sale,
} from '@/types/database';

const now = new Date();
const todayIso = now.toISOString();
const morningIso = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 9, 40).toISOString();
const midDayIso = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 12, 15).toISOString();
const yesterdayIso = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 17, 30).toISOString();

export type PreviewBundle = {
  products: Product[];
  sales: Sale[];
  expenses: Expense[];
  debts: Debt[];
  purchases: Purchase[];
  quotations: Quotation[];
  operationCashInjections: OperationCashInjection[];
  operationCashAudit: OperationCashAuditEvent[];
};

const products: Product[] = [
  {
    id: 'preview-dumbbell-5kg',
    branch_id: 'adiasports',
    name: 'Dumbbell 5kg Pair',
    sku: 'FIT-001',
    unit: 'pair',
    category: 'Weights',
    quantity: 18,
    reorder_level: 6,
    cost_price: 42000,
    unit_price: 55000,
    created_by: 'preview',
    created_at: todayIso,
  },
  {
    id: 'preview-yoga-mat',
    branch_id: 'adiasports',
    name: 'Yoga Mat 6mm',
    sku: 'FIT-004',
    unit: 'pcs',
    category: 'Accessories',
    quantity: 28,
    reorder_level: 10,
    cost_price: 22000,
    unit_price: 35000,
    created_by: 'preview',
    created_at: todayIso,
  },
  {
    id: 'preview-bike',
    branch_id: 'fitness-empire',
    name: 'Exercise Bike',
    sku: 'FIT-011',
    unit: 'pcs',
    category: 'Cardio',
    quantity: 2,
    reorder_level: 3,
    cost_price: 420000,
    unit_price: 550000,
    created_by: 'preview',
    created_at: todayIso,
  },
];

const sales: Sale[] = [
  {
    id: 'preview-sale-1',
    sale_number: 'ADIA-2026-0001',
    branch_id: 'adiasports',
    product_id: 'preview-dumbbell-5kg',
    quantity: 2,
    unit_price: 55000,
    amount_paid: 110000,
    customer_name: null,
    payment_status: 'paid',
    payment_method: 'cash',
    note: null,
    created_by: 'manager-preview',
    created_at: morningIso,
    products: { id: 'preview-dumbbell-5kg', name: 'Dumbbell 5kg Pair', unit: 'pair', sku: 'FIT-001', cost_price: 42000 },
  },
  {
    id: 'preview-sale-2',
    sale_number: 'ADIA-2026-0002',
    branch_id: 'adiasports',
    product_id: 'preview-yoga-mat',
    quantity: 3,
    unit_price: 35000,
    amount_paid: 70000,
    customer_name: 'Juma Said',
    payment_status: 'partial',
    payment_method: 'mpesa',
    note: 'Amebaki kulipa sehemu',
    created_by: 'manager-preview',
    created_at: midDayIso,
    products: { id: 'preview-yoga-mat', name: 'Yoga Mat 6mm', unit: 'pcs', sku: 'FIT-004', cost_price: 22000 },
  },
];

const expenses: Expense[] = [
  {
    id: 'preview-expense-fuel',
    branch_id: 'adiasports',
    title: 'Mafuta ya delivery',
    category: 'Fuel / Mafuta',
    amount: 30000,
    note: 'Usafiri wa stock kutoka supplier',
    receipt_file_name: 'receipt-fuel.jpg',
    receipt_mime_type: 'image/jpeg',
    receipt_storage_path: 'preview/receipt-fuel.jpg',
    receipt_attached_at: todayIso,
    created_by: 'manager-preview',
    created_at: morningIso,
    profiles: { id: 'manager-preview', full_name: 'Manager' },
  },
  {
    id: 'preview-expense-transport',
    branch_id: 'adiasports',
    title: 'Usafiri wa fundi',
    category: 'Transport',
    amount: 22000,
    note: 'Service ya treadmill',
    receipt_file_name: null,
    receipt_mime_type: null,
    receipt_storage_path: null,
    receipt_attached_at: null,
    created_by: 'cashier-preview',
    created_at: midDayIso,
    profiles: { id: 'cashier-preview', full_name: 'Cashier' },
  },
  {
    id: 'preview-expense-cleaning',
    branch_id: 'fitness-empire',
    title: 'Vifaa vya usafi',
    category: 'Utilities',
    amount: 18000,
    note: null,
    created_by: 'manager-preview',
    created_at: yesterdayIso,
  },
];

const debts: Debt[] = [
  {
    id: 'preview-debt-1',
    branch_id: 'adiasports',
    sale_id: 'preview-sale-2',
    customer_name: 'Juma Said',
    description: 'Yoga Mat 6mm x3',
    amount: 105000,
    amount_paid: 70000,
    due_date: new Date(now.getFullYear(), now.getMonth(), now.getDate() + 3).toISOString().slice(0, 10),
    status: 'partial',
    created_by: 'manager-preview',
    created_at: midDayIso,
  },
];

const purchases: Purchase[] = [
  {
    id: 'preview-purchase-1',
    branch_id: 'adiasports',
    supplier_name: 'Fitness Supplier TZ',
    invoice_number: 'SUP-001',
    product_id: 'preview-dumbbell-5kg',
    quantity: 10,
    cost_price: 42000,
    amount_paid: 300000,
    payment_status: 'partial',
    note: 'Stock ya dumbbells',
    created_by: 'manager-preview',
    created_at: yesterdayIso,
    products: { id: 'preview-dumbbell-5kg', name: 'Dumbbell 5kg Pair', unit: 'pair', sku: 'FIT-001' },
  },
];

const quotations: Quotation[] = [
  {
    id: 'preview-quote-1',
    branch_id: 'adiasports',
    customer_name: 'Gym Client',
    customer_contact: '0712 000 000',
    quote_number: 'QT-2026-0001',
    total_amount: 350000,
    status: 'draft',
    note: 'Home gym starter pack',
    valid_until: null,
    created_by: 'manager-preview',
    created_at: todayIso,
  },
];

const operationCashInjections: OperationCashInjection[] = [
  {
    id: 'preview-injection-1',
    branch_id: 'adiasports',
    amount: 150000,
    note: 'Operation cash ya wiki',
    injected_by: 'owner-preview',
    created_at: morningIso,
  },
];

export function getPreviewData(branchId?: string | null): PreviewBundle {
  const include = <T extends { branch_id?: string | null }>(rows: T[]) =>
    branchId ? rows.filter((row) => row.branch_id === branchId) : rows;
  const branchExpenses = include(expenses);
  const branchInjections = include(operationCashInjections);
  let runningBalance = branchInjections.reduce((sum, row) => sum + row.amount, 0);
  const operationCashAudit: OperationCashAuditEvent[] = [
    ...branchInjections.map((row) => ({
      event_id: row.id,
      event_type: 'injection' as const,
      branch_id: row.branch_id,
      title: row.note ?? 'Operation cash injection',
      amount: row.amount,
      actor_id: row.injected_by,
      actor_name: 'Owner',
      created_at: row.created_at,
      balance_before: 0,
      balance_after: row.amount,
      has_receipt: false,
    })),
    ...branchExpenses.map((row) => {
      const before = runningBalance;
      runningBalance -= row.amount;
      return {
        event_id: row.id,
        event_type: 'expense' as const,
        branch_id: row.branch_id,
        title: row.title,
        amount: row.amount,
        actor_id: row.created_by,
        actor_name: row.profiles?.full_name ?? 'Staff',
        created_at: row.created_at,
        balance_before: before,
        balance_after: runningBalance,
        has_receipt: Boolean(row.receipt_storage_path || row.receipt_data_url || row.receipt_file_name),
      };
    }),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  return {
    products: include(products),
    sales: include(sales),
    expenses: branchExpenses,
    debts: include(debts),
    purchases: include(purchases),
    quotations: include(quotations),
    operationCashInjections: branchInjections,
    operationCashAudit,
  };
}

export function getPreviewOperationCashSummary(branchId?: string | null) {
  const data = getPreviewData(branchId);
  const injected_total = data.operationCashInjections.reduce((sum, row) => sum + row.amount, 0);
  const expenses_total = data.expenses.reduce((sum, row) => sum + row.amount, 0);
  return { injected_total, expenses_total, balance: injected_total - expenses_total };
}
