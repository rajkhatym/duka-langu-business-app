import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';
import { StatCard } from '@/components/stat-card';
import { Colors, Radius, Spacing } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useBranch } from '@/lib/branch-context';
import { downloadCsv, downloadExcel, printPdf, type ExportSection } from '@/lib/export-utils';
import { formatMoney } from '@/lib/format';
import { getLocalPurchases } from '@/lib/local-purchases';
import { getLocalReportSales } from '@/lib/local-report-sales';
import { supabase } from '@/lib/supabase';
import { isMissingCostPriceError } from '@/lib/supabase-errors';
import type { Debt, Expense, Product, Purchase, Sale } from '@/types/database';

type ExportKey = 'sales' | 'stock' | 'debts' | 'purchases' | 'expenses' | 'reports';

function saleTotal(sale: Sale) {
  return sale.quantity * sale.unit_price;
}

function saleBalance(sale: Sale) {
  return Math.max(saleTotal(sale) - sale.amount_paid, 0);
}

function debtBalance(debt: Debt) {
  return Math.max(debt.amount - debt.amount_paid, 0);
}

function purchaseTotal(purchase: Purchase) {
  return purchase.quantity * purchase.cost_price;
}

function purchaseBalance(purchase: Purchase) {
  return Math.max(purchaseTotal(purchase) - purchase.amount_paid, 0);
}

function todayStamp() {
  return new Date().toISOString().slice(0, 10);
}

export default function ExportCenterScreen() {
  const { isAdmin, isOwner } = useAuth();
  const { branches, selectedBranchId } = useBranch();
  const [exportBranchId, setExportBranchId] = useState(selectedBranchId);
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const scopedBranchId = exportBranchId === 'all' ? null : exportBranchId;
    const from = new Date();
    from.setFullYear(from.getFullYear() - 1);
    const fromIso = from.toISOString();

    const productsQuery = supabase.from('products').select('*').order('name').limit(5000);
    const salesQuery = supabase
      .from('sales')
      .select('*, products(id,name,unit,sku,cost_price), profiles(id,full_name)')
      .gte('created_at', fromIso)
      .order('created_at', { ascending: false })
      .limit(5000);
    const debtsQuery = supabase
      .from('debts')
      .select('*, profiles(id,full_name)')
      .order('created_at', { ascending: false })
      .limit(5000);
    const purchasesQuery = supabase
      .from('purchases')
      .select('*, products(id,name,unit,sku)')
      .gte('created_at', fromIso)
      .order('created_at', { ascending: false })
      .limit(5000);
    const expensesQuery = supabase
      .from('expenses')
      .select('*, profiles(id,full_name)')
      .gte('created_at', fromIso)
      .order('created_at', { ascending: false })
      .limit(5000);

    if (scopedBranchId) {
      productsQuery.eq('branch_id', scopedBranchId);
      salesQuery.eq('branch_id', scopedBranchId);
      debtsQuery.eq('branch_id', scopedBranchId);
      purchasesQuery.eq('branch_id', scopedBranchId);
      expensesQuery.eq('branch_id', scopedBranchId);
    }

    let [productsRes, salesRes, debtsRes, purchasesRes, expensesRes, localSales, localPurchases] = await Promise.all([
      productsQuery,
      salesQuery,
      debtsQuery,
      purchasesQuery,
      expensesQuery,
      getLocalReportSales(from, scopedBranchId),
      scopedBranchId
        ? getLocalPurchases(scopedBranchId)
        : Promise.all(branches.map((branch) => getLocalPurchases(branch.id))).then((rows) => rows.flat()),
    ]);

    if (isMissingCostPriceError(salesRes.error)) {
      const fallbackSalesQuery = supabase
        .from('sales')
        .select('*, products(id,name,unit,sku), profiles(id,full_name)')
        .gte('created_at', fromIso)
        .order('created_at', { ascending: false })
        .limit(5000);
      if (scopedBranchId) fallbackSalesQuery.eq('branch_id', scopedBranchId);
      salesRes = await fallbackSalesQuery;
    }

    setProducts(productsRes.error ? [] : ((productsRes.data as Product[]) ?? []));
    const remoteSales = salesRes.error ? [] : ((salesRes.data as unknown as Sale[]) ?? []);
    const remoteSaleKeys = new Set(
      remoteSales.map(
        (sale) =>
          `${sale.branch_id ?? 'none'}-${sale.product_id}-${sale.quantity}-${sale.unit_price}-${Math.round(
            new Date(sale.created_at).getTime() / 60000
          )}`
      )
    );
    const localOnlySales = localSales.filter(
      (sale) =>
        !remoteSaleKeys.has(
          `${sale.branch_id ?? 'none'}-${sale.product_id}-${sale.quantity}-${sale.unit_price}-${Math.round(
            new Date(sale.created_at).getTime() / 60000
          )}`
        )
    );
    setSales([...remoteSales, ...localOnlySales]);
    setDebts(debtsRes.error ? [] : ((debtsRes.data as unknown as Debt[]) ?? []));
    setPurchases([
      ...localPurchases.filter((purchase) => new Date(purchase.created_at) >= from),
      ...(purchasesRes.error ? [] : ((purchasesRes.data as unknown as Purchase[]) ?? [])),
    ]);
    setExpenses(expensesRes.error ? [] : ((expensesRes.data as unknown as Expense[]) ?? []));
  }, [branches, exportBranchId]);

  useFocusEffect(
    useCallback(() => {
      if (!isAdmin) {
        setLoading(false);
        return;
      }
      let active = true;
      (async () => {
        setLoading(true);
        await load();
        if (active) setLoading(false);
      })();
      return () => {
        active = false;
      };
    }, [isAdmin, load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const sections = useMemo<Record<ExportKey, ExportSection>>(() => {
    const salesSection: ExportSection = {
      title: 'Sales',
      headers: [
        'Sale No',
        'Date',
        'Branch',
        'Product',
        'SKU',
        'Customer',
        'Qty',
        'Unit price',
        'Total',
        'Paid',
        'Balance',
        'Payment status',
        'Payment method',
        'Cashier',
        'Note',
      ],
      rows: sales.map((sale) => [
        sale.sale_number ?? sale.id.slice(0, 8).toUpperCase(),
        sale.created_at,
        sale.branch_id ?? '',
        sale.products?.name ?? sale.product_id,
        sale.products?.sku ?? '',
        sale.customer_name ?? 'Walk-in',
        sale.quantity,
        sale.unit_price,
        saleTotal(sale),
        sale.amount_paid,
        saleBalance(sale),
        sale.payment_status,
        sale.payment_method ?? 'cash',
        sale.profiles?.full_name ?? '',
        sale.note ?? '',
      ]),
    };

    const stockSection: ExportSection = {
      title: 'Stock',
      headers: isOwner
        ? [
            'Branch',
            'Name',
            'SKU',
            'Category',
            'Variant size',
            'Variant color',
            'Variant weight',
            'Qty',
            'Reorder level',
            'Cost price',
            'Selling price',
            'Stock value',
            'Warranty months',
          ]
        : ['Branch', 'Name', 'SKU', 'Category', 'Variant size', 'Variant color', 'Variant weight', 'Qty', 'Reorder level', 'Selling price', 'Warranty months'],
      rows: products.map((product) => [
        product.branch_id ?? '',
        product.name,
        product.sku ?? '',
        product.category ?? '',
        product.variant_size ?? '',
        product.variant_color ?? '',
        product.variant_weight ?? '',
        product.quantity,
        product.reorder_level,
        ...(isOwner ? [product.cost_price ?? 0] : []),
        product.unit_price ?? 0,
        ...(isOwner ? [product.quantity * (product.cost_price ?? 0)] : []),
        product.warranty_months ?? '',
      ]),
    };

    const debtsSection: ExportSection = {
      title: 'Debts',
      headers: ['Date', 'Branch', 'Customer', 'Description', 'Amount', 'Paid', 'Balance', 'Due date', 'Status'],
      rows: debts.map((debt) => [
        debt.created_at,
        debt.branch_id ?? '',
        debt.customer_name,
        debt.description ?? '',
        debt.amount,
        debt.amount_paid,
        debtBalance(debt),
        debt.due_date ?? '',
        debt.status,
      ]),
    };

    const purchasesSection: ExportSection = {
      title: 'Purchases',
      headers: isOwner
        ? [
            'Date',
            'Branch',
            'Supplier',
            'Invoice',
            'Product',
            'SKU',
            'Qty',
            'Cost price',
            'Total',
            'Paid',
            'Balance',
            'Status',
            'Note',
          ]
        : ['Date', 'Branch', 'Supplier', 'Invoice', 'Product', 'SKU', 'Qty', 'Paid', 'Status', 'Note'],
      rows: purchases.map((purchase) => [
        purchase.created_at,
        purchase.branch_id ?? '',
        purchase.supplier_name,
        purchase.invoice_number ?? '',
        purchase.products?.name ?? purchase.product_id,
        purchase.products?.sku ?? '',
        purchase.quantity,
        ...(isOwner ? [purchase.cost_price, purchaseTotal(purchase)] : []),
        purchase.amount_paid,
        ...(isOwner ? [purchaseBalance(purchase)] : []),
        purchase.payment_status,
        purchase.note ?? '',
      ]),
    };

    const expensesSection: ExportSection = {
      title: 'Expenses',
      headers: ['Date', 'Branch', 'Title', 'Category', 'Amount', 'Staff', 'Receipt', 'Note'],
      rows: expenses.map((expense) => [
        expense.created_at,
        expense.branch_id ?? '',
        expense.title,
        expense.category ?? '',
        expense.amount,
        expense.profiles?.full_name ?? '',
        expense.receipt_file_name ?? (expense.receipt_storage_path || expense.receipt_data_url ? 'Attached' : ''),
        expense.note ?? '',
      ]),
    };

    const salesRevenue = sales.reduce((sum, sale) => sum + saleTotal(sale), 0);
    const collected = sales.reduce((sum, sale) => sum + sale.amount_paid, 0);
    const cogs = sales.reduce((sum, sale) => sum + sale.quantity * (sale.products?.cost_price ?? 0), 0);
    const expensesTotal = expenses.reduce((sum, expense) => sum + expense.amount, 0);
    const debtsOpen = debts.reduce((sum, debt) => sum + debtBalance(debt), 0);
    const purchasesTotal = purchases.reduce((sum, purchase) => sum + purchaseTotal(purchase), 0);
    const supplierBalance = purchases.reduce((sum, purchase) => sum + purchaseBalance(purchase), 0);
    const stockValue = products.reduce((sum, product) => sum + product.quantity * (product.cost_price ?? 0), 0);
    const lowStock = products.filter((product) => product.quantity <= product.reorder_level).length;
    const reportsSection: ExportSection = {
      title: 'Reports Summary',
      headers: ['Metric', 'Value'],
      rows: isOwner
        ? [
            ['Sales revenue', salesRevenue],
            ['Collected', collected],
            ['Sales balance', Math.max(salesRevenue - collected, 0)],
            ['Cost of goods', cogs],
            ['Gross profit', salesRevenue - cogs],
            ['Expenses', expensesTotal],
            ['Net profit', salesRevenue - cogs - expensesTotal],
            ['Customer debts open', debtsOpen],
            ['Purchases total', purchasesTotal],
            ['Supplier balance', supplierBalance],
            ['Stock value', stockValue],
            ['Low stock items', lowStock],
            ['Products count', products.length],
            ['Sales rows', sales.length],
          ]
        : [
            ['Sales revenue', salesRevenue],
            ['Collected', collected],
            ['Sales balance', Math.max(salesRevenue - collected, 0)],
            ['Expenses', expensesTotal],
            ['Customer debts open', debtsOpen],
            ['Low stock items', lowStock],
            ['Products count', products.length],
            ['Sales rows', sales.length],
          ],
    };

    return {
      sales: salesSection,
      stock: stockSection,
      debts: debtsSection,
      purchases: purchasesSection,
      expenses: expensesSection,
      reports: reportsSection,
    };
  }, [debts, expenses, isOwner, products, purchases, sales]);

  const allSections = [
    sections.reports,
    sections.sales,
    sections.stock,
    sections.debts,
    sections.purchases,
    sections.expenses,
  ];
  const scopeName = exportBranchId === 'all' ? 'all-branches' : exportBranchId;
  const baseName = `backup-${scopeName}-${todayStamp()}`;
  const salesRevenue = sales.reduce((sum, sale) => sum + saleTotal(sale), 0);
  const stockValue = products.reduce((sum, product) => sum + product.quantity * (product.cost_price ?? 0), 0);
  const debtOpen = debts.reduce((sum, debt) => sum + debtBalance(debt), 0);
  const expenseTotal = expenses.reduce((sum, expense) => sum + expense.amount, 0);

  const exportOne = (key: ExportKey, format: 'excel' | 'pdf') => {
    const section = sections[key];
    if (format === 'excel') {
      downloadExcel(`${key}-${scopeName}-${todayStamp()}.xls`, [section]);
      return;
    }
    printPdf(`${section.title} ${scopeName}`, [section]);
  };

  if (!isAdmin) {
    return (
      <Screen>
        <View style={styles.permissionBox}>
          <Text style={styles.permissionTitle}>Backup imefungwa</Text>
          <Text style={styles.permissionText}>Export inaonekana kwa Owner au Manager tu.</Text>
        </View>
      </Screen>
    );
  }

  if (loading) {
    return (
      <Screen>
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <View style={styles.header}>
          <Text style={styles.title}>Backup / Export Center</Text>
          <Text style={styles.subtitle}>
            Pakua Excel au PDF kwa sales, stock, debts, purchases, expenses na reports. Data inafuata branch na permissions zako.
          </Text>
        </View>

        <View style={styles.branchFilters}>
          {branches.map((branch) => (
            <BranchFilter
              key={branch.id}
              label={branch.name}
              active={exportBranchId === branch.id}
              onPress={() => setExportBranchId(branch.id)}
            />
          ))}
          {branches.length > 1 ? (
            <BranchFilter label="Zote" active={exportBranchId === 'all'} onPress={() => setExportBranchId('all')} />
          ) : null}
        </View>

        <View style={styles.statsGrid}>
          <StatCard label="Mauzo" value={`Tsh ${formatMoney(salesRevenue)}`} />
          <StatCard label="Stock Value" value={`Tsh ${formatMoney(stockValue)}`} />
        </View>
        <View style={styles.statsGrid}>
          <StatCard label="Madeni Wazi" value={`Tsh ${formatMoney(debtOpen)}`} tone="danger" />
          <StatCard label="Matumizi" value={`Tsh ${formatMoney(expenseTotal)}`} tone="danger" />
        </View>

        <View style={styles.fullBackupCard}>
          <View style={styles.fullBackupText}>
            <Text style={styles.cardTitle}>Full backup ya biashara</Text>
            <Text style={styles.cardSubtitle}>
              File moja yenye tabs/sections zote: report summary, sales, stock, debts, purchases na expenses.
            </Text>
          </View>
          <View style={styles.fullBackupActions}>
            <Pressable style={styles.primaryButton} onPress={() => downloadExcel(`${baseName}.xls`, allSections)}>
              <Text style={styles.primaryButtonText}>Excel</Text>
            </Pressable>
            <Pressable style={styles.secondaryButton} onPress={() => printPdf(`Business Backup ${scopeName}`, allSections)}>
              <Text style={styles.secondaryButtonText}>PDF</Text>
            </Pressable>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Export kwa kila sehemu</Text>
        <ExportCard
          title="Sales"
          meta={`${sales.length} rows · TZS ${formatMoney(salesRevenue)}`}
          onExcel={() => exportOne('sales', 'excel')}
          onCsv={() => downloadCsv(`sales-${scopeName}-${todayStamp()}.csv`, sections.sales.headers, sections.sales.rows)}
          onPdf={() => exportOne('sales', 'pdf')}
        />
        <ExportCard
          title="Stock"
          meta={isOwner ? `${products.length} bidhaa · value TZS ${formatMoney(stockValue)}` : `${products.length} bidhaa`}
          onExcel={() => exportOne('stock', 'excel')}
          onCsv={() => downloadCsv(`stock-${scopeName}-${todayStamp()}.csv`, sections.stock.headers, sections.stock.rows)}
          onPdf={() => exportOne('stock', 'pdf')}
        />
        <ExportCard
          title="Debts"
          meta={`${debts.length} rows · open TZS ${formatMoney(debtOpen)}`}
          onExcel={() => exportOne('debts', 'excel')}
          onCsv={() => downloadCsv(`debts-${scopeName}-${todayStamp()}.csv`, sections.debts.headers, sections.debts.rows)}
          onPdf={() => exportOne('debts', 'pdf')}
        />
        <ExportCard
          title="Purchases"
          meta={
            isOwner
              ? `${purchases.length} rows · supplier balance TZS ${formatMoney(
                  purchases.reduce((sum, purchase) => sum + purchaseBalance(purchase), 0)
                )}`
              : `${purchases.length} rows`
          }
          onExcel={() => exportOne('purchases', 'excel')}
          onCsv={() =>
            downloadCsv(`purchases-${scopeName}-${todayStamp()}.csv`, sections.purchases.headers, sections.purchases.rows)
          }
          onPdf={() => exportOne('purchases', 'pdf')}
        />
        <ExportCard
          title="Expenses"
          meta={`${expenses.length} rows · TZS ${formatMoney(expenseTotal)}`}
          onExcel={() => exportOne('expenses', 'excel')}
          onCsv={() =>
            downloadCsv(`expenses-${scopeName}-${todayStamp()}.csv`, sections.expenses.headers, sections.expenses.rows)
          }
          onPdf={() => exportOne('expenses', 'pdf')}
        />
        {isOwner ? (
          <ExportCard
            title="Reports"
            meta="Summary ya profit, debts, stock value na low stock"
            onExcel={() => exportOne('reports', 'excel')}
            onCsv={() => downloadCsv(`reports-${scopeName}-${todayStamp()}.csv`, sections.reports.headers, sections.reports.rows)}
            onPdf={() => exportOne('reports', 'pdf')}
          />
        ) : null}

        {sales.length + products.length + debts.length + purchases.length + expenses.length === 0 ? (
          <EmptyState title="Hakuna data ya ku-export" subtitle="Ukianza kurekodi biashara, data itaonekana hapa." />
        ) : null}

        <Pressable style={styles.backButton} onPress={() => router.back()}>
          <Text style={styles.backButtonText}>Rudi</Text>
        </Pressable>
      </ScrollView>
    </Screen>
  );
}

function BranchFilter({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.branchFilter, active && styles.branchFilterActive]} onPress={onPress}>
      <Text style={[styles.branchFilterText, active && styles.branchFilterTextActive]}>{label}</Text>
    </Pressable>
  );
}

function ExportCard({
  title,
  meta,
  onExcel,
  onCsv,
  onPdf,
}: {
  title: string;
  meta: string;
  onExcel: () => void;
  onCsv: () => void;
  onPdf: () => void;
}) {
  return (
    <View style={styles.exportCard}>
      <View style={styles.exportCardText}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardSubtitle}>{meta}</Text>
      </View>
      <View style={styles.exportActions}>
        <Pressable style={styles.smallButton} onPress={onExcel}>
          <Text style={styles.smallButtonText}>Excel</Text>
        </Pressable>
        <Pressable style={styles.smallButton} onPress={onCsv}>
          <Text style={styles.smallButtonText}>CSV</Text>
        </Pressable>
        <Pressable style={styles.smallButtonMuted} onPress={onPdf}>
          <Text style={styles.smallButtonMutedText}>PDF</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingVertical: Spacing.lg,
    paddingBottom: Spacing.xxl,
  },
  header: {
    gap: Spacing.xs,
    marginBottom: Spacing.md,
  },
  title: {
    color: Colors.text,
    fontSize: 22,
    fontWeight: '600',
  },
  subtitle: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 19,
  },
  branchFilters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  branchFilter: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  branchFilterActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  branchFilterText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
  },
  branchFilterTextActive: {
    color: Colors.white,
  },
  statsGrid: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  fullBackupCard: {
    backgroundColor: Colors.primaryDark,
    borderRadius: Radius.md,
    padding: Spacing.lg,
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  fullBackupText: {
    gap: Spacing.xs,
  },
  fullBackupActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  sectionTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '600',
    marginBottom: Spacing.md,
  },
  exportCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  exportCardText: {
    gap: Spacing.xs,
  },
  cardTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  cardSubtitle: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 17,
  },
  exportActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  primaryButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: Radius.md,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryButtonText: {
    color: Colors.primaryDark,
    fontWeight: '600',
  },
  secondaryButton: {
    flex: 1,
    minHeight: 44,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: Colors.white,
    fontWeight: '600',
  },
  smallButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: Radius.sm,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallButtonText: {
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '600',
  },
  smallButtonMuted: {
    flex: 1,
    minHeight: 40,
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  smallButtonMutedText: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  backButton: {
    minHeight: 46,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.sm,
  },
  backButtonText: {
    color: Colors.text,
    fontWeight: '600',
  },
  permissionBox: {
    marginTop: Spacing.xl,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    padding: Spacing.lg,
    gap: Spacing.sm,
  },
  permissionTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '600',
  },
  permissionText: {
    color: Colors.textMuted,
    fontWeight: '400',
    lineHeight: 20,
  },
});
