export type UserRole = 'owner' | 'manager' | 'cashier' | 'admin' | 'staff';

export interface Profile {
  id: string;
  full_name: string | null;
  role: UserRole;
  branch_id?: string | null;
  password_must_change?: boolean | null;
  last_password_change_at?: string | null;
  created_at: string;
}

export interface Branch {
  id: string;
  name: string;
  created_at?: string;
}

export interface Product {
  id: string;
  branch_id?: string | null;
  name: string;
  sku: string | null;
  unit: string;
  category: string | null;
  variant_size?: string | null;
  variant_color?: string | null;
  variant_weight?: string | null;
  warranty_months?: number | null;
  quantity: number;
  reorder_level: number;
  cost_price: number | null;
  unit_price: number | null;
  created_by: string | null;
  created_at: string;
}

export type MovementType = 'IN' | 'OUT';

export interface StockMovement {
  id: string;
  branch_id?: string | null;
  product_id: string;
  type: MovementType;
  quantity: number;
  note: string | null;
  created_by: string | null;
  created_at: string;
  products?: Pick<Product, 'id' | 'name' | 'unit' | 'sku'> | null;
  profiles?: Pick<Profile, 'id' | 'full_name'> | null;
}

export interface StockTransfer {
  id: string;
  product_id: string;
  from_branch_id: string;
  to_branch_id: string;
  quantity: number;
  note: string | null;
  created_by: string | null;
  created_at: string;
  products?: Pick<Product, 'id' | 'name' | 'unit' | 'sku'> | null;
  profiles?: Pick<Profile, 'id' | 'full_name'> | null;
}

export interface StoreLogBookEntry {
  id: string;
  branch_id?: string | null;
  movement_type?: 'store_to_shop' | 'store_to_customer' | 'store_to_branch' | 'return_to_store' | null;
  status?: 'pending' | 'approved' | 'rejected' | null;
  person_name: string;
  product_id: string | null;
  product_name: string;
  quantity: number;
  unit: string | null;
  note: string | null;
  approved_by?: string | null;
  approved_at?: string | null;
  approval_note?: string | null;
  created_by: string | null;
  created_at: string;
  products?: Pick<Product, 'id' | 'name' | 'unit' | 'sku'> | null;
  profiles?: Pick<Profile, 'id' | 'full_name'> | null;
  approver?: Pick<Profile, 'id' | 'full_name'> | null;
}

export type PaymentStatus = 'paid' | 'partial' | 'credit';
export type PaymentMethod = 'cash' | 'mpesa' | 'bank' | 'credit';
export type DebtStatus = 'open' | 'partial' | 'paid';
export type SupplierPaymentStatus = 'paid' | 'partial' | 'credit';
export type ShiftStatus = 'open' | 'closed';

export interface Sale {
  id: string;
  sale_number?: string | null;
  client_sale_id?: string | null;
  branch_id?: string | null;
  product_id: string;
  quantity: number;
  unit_price: number;
  amount_paid: number;
  customer_name: string | null;
  payment_status: PaymentStatus;
  payment_method?: PaymentMethod | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  products?: Pick<Product, 'id' | 'name' | 'unit' | 'sku' | 'cost_price' | 'warranty_months'> | null;
  profiles?: Pick<Profile, 'id' | 'full_name'> | null;
}

export interface Expense {
  id: string;
  branch_id?: string | null;
  title: string;
  category: string | null;
  amount: number;
  note: string | null;
  receipt_file_name?: string | null;
  receipt_mime_type?: string | null;
  receipt_data_url?: string | null;
  receipt_storage_path?: string | null;
  receipt_attached_at?: string | null;
  created_by: string | null;
  created_at: string;
  profiles?: Pick<Profile, 'id' | 'full_name'> | null;
}

export interface OperationCashInjection {
  id: string;
  branch_id?: string | null;
  amount: number;
  note: string | null;
  injected_by: string | null;
  created_at: string;
  profiles?: Pick<Profile, 'id' | 'full_name'> | null;
}

export interface OperationCashAuditEvent {
  event_id: string;
  event_type: 'injection' | 'expense';
  branch_id?: string | null;
  title: string;
  amount: number;
  actor_id: string | null;
  actor_name: string | null;
  created_at: string;
  balance_before: number;
  balance_after: number;
  has_receipt: boolean;
}

export interface Debt {
  id: string;
  branch_id?: string | null;
  sale_id: string | null;
  customer_name: string;
  description: string | null;
  amount: number;
  amount_paid: number;
  due_date: string | null;
  status: DebtStatus;
  created_by: string | null;
  created_at: string;
  profiles?: Pick<Profile, 'id' | 'full_name'> | null;
}

export interface WingaCustomer {
  id: string;
  branch_id?: string | null;
  name: string;
  contact: string | null;
  note: string | null;
  status: 'active' | 'inactive';
  created_by: string | null;
  created_at: string;
  profiles?: Pick<Profile, 'id' | 'full_name'> | null;
}

export interface DailyClosing {
  id: string;
  branch_id: string;
  closing_date: string;
  expected_cash: number;
  actual_cash: number;
  difference: number;
  note: string | null;
  created_by: string | null;
  created_at: string;
  profiles?: Pick<Profile, 'id' | 'full_name'> | null;
}

export interface AuditLog {
  id: string;
  actor_id: string | null;
  branch_id: string | null;
  table_name: string;
  action: string;
  record_id: string | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  created_at: string;
  profiles?: Pick<Profile, 'id' | 'full_name'> | null;
}

export interface Purchase {
  id: string;
  branch_id?: string | null;
  supplier_name: string;
  invoice_number: string | null;
  product_id: string;
  quantity: number;
  cost_price: number;
  amount_paid: number;
  payment_status: SupplierPaymentStatus;
  note: string | null;
  created_by: string | null;
  created_at: string;
  products?: Pick<Product, 'id' | 'name' | 'unit' | 'sku'> | null;
}

export interface CashShift {
  id: string;
  branch_id?: string | null;
  cashier_id: string | null;
  opening_cash: number;
  closing_cash: number | null;
  expected_cash: number | null;
  difference: number | null;
  status: ShiftStatus;
  opened_at: string;
  closed_at: string | null;
  note: string | null;
}

export type StockAdjustmentStatus = 'pending' | 'approved' | 'rejected';

export interface StockAdjustmentRequest {
  id: string;
  branch_id?: string | null;
  product_id: string;
  requested_quantity: number;
  reason: string | null;
  status: StockAdjustmentStatus;
  requested_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  products?: Pick<Product, 'id' | 'name' | 'unit' | 'sku' | 'quantity'> | null;
}

export interface StockCount {
  id: string;
  branch_id?: string | null;
  product_id: string;
  system_quantity: number;
  counted_quantity: number;
  difference: number;
  note: string | null;
  counted_by: string | null;
  created_at: string;
  products?: Pick<Product, 'id' | 'name' | 'unit' | 'sku'> | null;
}

export interface Quotation {
  id: string;
  branch_id?: string | null;
  customer_name: string;
  customer_contact: string | null;
  quote_number: string | null;
  total_amount: number;
  status: 'draft' | 'sent' | 'accepted' | 'rejected' | 'converted';
  note: string | null;
  valid_until: string | null;
  created_by: string | null;
  created_at: string;
}

export interface Layaway {
  id: string;
  branch_id?: string | null;
  customer_name: string;
  customer_contact: string | null;
  product_id: string | null;
  total_amount: number;
  amount_paid: number;
  status: 'open' | 'completed' | 'cancelled';
  due_date: string | null;
  note: string | null;
  created_by: string | null;
  created_at: string;
  products?: Pick<Product, 'id' | 'name' | 'unit' | 'sku'> | null;
}

export interface ProductBundle {
  id: string;
  branch_id?: string | null;
  name: string;
  sku: string | null;
  bundle_price: number;
  active: boolean;
  created_by: string | null;
  created_at: string;
}

export interface WarrantyClaim {
  id: string;
  branch_id?: string | null;
  sale_id: string | null;
  product_id: string | null;
  customer_name: string;
  issue: string;
  action: 'review' | 'repair' | 'exchange' | 'refund' | 'reject';
  status: 'pending' | 'approved' | 'rejected' | 'completed';
  created_by: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  products?: Pick<Product, 'id' | 'name' | 'unit' | 'sku'> | null;
}
