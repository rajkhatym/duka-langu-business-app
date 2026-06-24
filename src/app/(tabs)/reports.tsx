import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ProductListItem } from '@/components/product-list-item';
import { Screen } from '@/components/screen';
import { StatCard } from '@/components/stat-card';
import { Colors, Radius, Spacing } from '@/constants/colors';
import { isAnyPreviewMode, useAuth } from '@/lib/auth-context';
import { useBranch } from '@/lib/branch-context';
import { formatMoney, formatQuantity } from '@/lib/format';
import { getLocalReportSales } from '@/lib/local-report-sales';
import { getPreviewData } from '@/lib/preview-data';
import { supabase } from '@/lib/supabase';
import { isMissingCostPriceError } from '@/lib/supabase-errors';
import type { Debt, Expense, Product, Quotation, Sale, StockMovement } from '@/types/database';

interface PeriodTotals {
  in: number;
  out: number;
}

type ReportDetailType = 'sales' | 'payments' | 'expenses' | 'debts' | 'profit' | 'cogs' | 'low_stock';
type ReceiptPreview = {
  title: string;
  url: string | null;
  mimeType: string | null;
  message: string | null;
};

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function sumByType(movements: StockMovement[], from: Date): PeriodTotals {
  return movements.reduce<PeriodTotals>(
    (acc, m) => {
      if (new Date(m.created_at) < from) return acc;
      if (m.type === 'IN') acc.in += m.quantity;
      else acc.out += m.quantity;
      return acc;
    },
    { in: 0, out: 0 }
  );
}

function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows
    .map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(','))
    .join('\n');

  if (Platform.OS !== 'web' || typeof document === 'undefined') {
    Alert.alert('Export', csv);
    return;
  }

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

async function openUrl(url: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) window.location.href = url;
    return;
  }
  await Linking.openURL(url);
}

export default function ReportsScreen() {
  const { isAdmin, isOwner } = useAuth();
  const { branches, selectedBranchId } = useBranch();
  const previewMode = isAnyPreviewMode();
  const [reportBranchId, setReportBranchId] = useState<string>(selectedBranchId);
  const [products, setProducts] = useState<Product[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [detailType, setDetailType] = useState<ReportDetailType | null>(null);

  const load = useCallback(async () => {
    const monthAgo = new Date();
    monthAgo.setDate(monthAgo.getDate() - 30);
    const scopedBranchId = reportBranchId === 'all' ? null : reportBranchId;

    const productQuery = supabase.from('products').select('*').order('name');
    const movementsQuery = supabase
      .from('stock_movements')
      .select('*, products(id,name,unit,sku), profiles(id,full_name)')
      .gte('created_at', monthAgo.toISOString())
      .order('created_at', { ascending: false });
    const salesQuery = supabase
      .from('sales')
      .select('*, products(id,name,unit,sku,cost_price), profiles(id,full_name)')
      .gte('created_at', monthAgo.toISOString())
      .order('created_at', { ascending: false });
    const expensesQuery = supabase
      .from('expenses')
      .select('*')
      .gte('created_at', monthAgo.toISOString())
      .order('created_at', { ascending: false });
    const debtsQuery = supabase.from('debts').select('*, profiles(id,full_name)').neq('status', 'paid');
    const quotationsQuery = supabase
      .from('quotations')
      .select('*')
      .gte('created_at', monthAgo.toISOString())
      .order('created_at', { ascending: false });

    if (scopedBranchId) {
      productQuery.eq('branch_id', scopedBranchId);
      movementsQuery.eq('branch_id', scopedBranchId);
      salesQuery.eq('branch_id', scopedBranchId);
      expensesQuery.eq('branch_id', scopedBranchId);
      debtsQuery.eq('branch_id', scopedBranchId);
      quotationsQuery.eq('branch_id', scopedBranchId);
    }

    let [productsRes, movementsRes, salesRes, expensesRes, debtsRes, quotationsRes, localSales] = await Promise.all([
      productQuery,
      movementsQuery,
      salesQuery,
      expensesQuery,
      debtsQuery,
      quotationsQuery,
      getLocalReportSales(monthAgo, scopedBranchId),
    ]);

    if (isMissingCostPriceError(salesRes.error)) {
      const fallbackSalesQuery = supabase
        .from('sales')
        .select('*, products(id,name,unit,sku), profiles(id,full_name)')
        .gte('created_at', monthAgo.toISOString())
        .order('created_at', { ascending: false });
      if (scopedBranchId) fallbackSalesQuery.eq('branch_id', scopedBranchId);
      salesRes = await fallbackSalesQuery;
    }

    if (productsRes.error?.message.includes('branch_id')) {
      productsRes = await supabase.from('products').select('*').order('name');
    }
    if (movementsRes.error?.message.includes('branch_id')) {
      movementsRes = await supabase
        .from('stock_movements')
        .select('*, products(id,name,unit,sku), profiles(id,full_name)')
        .gte('created_at', monthAgo.toISOString())
        .order('created_at', { ascending: false });
    }
    if (salesRes.error?.message.includes('branch_id')) {
      salesRes = await supabase
        .from('sales')
        .select('*, products(id,name,unit,sku), profiles(id,full_name)')
        .gte('created_at', monthAgo.toISOString())
        .order('created_at', { ascending: false });
    }
    if (expensesRes.error?.message.includes('branch_id')) {
      expensesRes = await supabase
        .from('expenses')
        .select('*')
        .gte('created_at', monthAgo.toISOString())
        .order('created_at', { ascending: false });
    }
    if (expensesRes.error) {
      expensesRes = await supabase
        .from('expenses')
        .select('*')
        .gte('created_at', monthAgo.toISOString())
        .order('created_at', { ascending: false });
      if (scopedBranchId) expensesRes = await supabase
        .from('expenses')
        .select('*')
        .eq('branch_id', scopedBranchId)
        .gte('created_at', monthAgo.toISOString())
        .order('created_at', { ascending: false });
    }
    if (debtsRes.error?.message.includes('branch_id')) {
      debtsRes = await supabase.from('debts').select('*, profiles(id,full_name)').neq('status', 'paid');
    }
    if (quotationsRes.error?.message.includes('branch_id')) {
      quotationsRes = await supabase
        .from('quotations')
        .select('*')
        .gte('created_at', monthAgo.toISOString())
        .order('created_at', { ascending: false });
    }

    let nextProducts = (productsRes.data as Product[]) ?? [];
    setMovements((movementsRes.data as unknown as StockMovement[]) ?? []);
    const remoteSales = (salesRes.data as unknown as Sale[]) ?? [];
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
    let nextSales = [...remoteSales, ...localOnlySales];
    let nextExpenses = (expensesRes.data as unknown as Expense[]) ?? [];
    let nextDebts = (debtsRes.data as unknown as Debt[]) ?? [];
    let nextQuotations = quotationsRes.error ? [] : ((quotationsRes.data as Quotation[]) ?? []);
    if (previewMode && nextProducts.length + nextSales.length + nextExpenses.length + nextDebts.length === 0) {
      const preview = getPreviewData(scopedBranchId);
      nextProducts = preview.products;
      nextSales = preview.sales;
      nextExpenses = preview.expenses;
      nextDebts = preview.debts;
      nextQuotations = preview.quotations;
    }
    setProducts(nextProducts);
    setSales(nextSales);
    setExpenses(nextExpenses);
    setDebts(nextDebts);
    setQuotations(nextQuotations);
  }, [previewMode, reportBranchId]);

  useFocusEffect(
    useCallback(() => {
      if (!isAdmin) {
        setLoading(false);
        return;
      }
      let active = true;
      (async () => {
        setLoading(true);
        try {
          await load();
        } catch {
          if (previewMode) {
            const preview = getPreviewData(reportBranchId === 'all' ? null : reportBranchId);
            setProducts(preview.products);
            setMovements([]);
            setSales(preview.sales);
            setExpenses(preview.expenses);
            setDebts(preview.debts);
            setQuotations(preview.quotations);
          }
        } finally {
          if (active) setLoading(false);
        }
      })();
      return () => {
        active = false;
      };
    }, [isAdmin, load, previewMode, reportBranchId])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  if (!isAdmin) {
    return (
      <Screen>
        <View style={styles.permissionBox}>
          <Text style={styles.permissionTitle}>Ripoti zimefungwa</Text>
          <Text style={styles.permissionText}>Cashier anaweza kuuza tu. Ripoti zinaonekana kwa Owner au Manager.</Text>
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

  const today = startOfDay(new Date());
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 7);
  const monthAgo = new Date(today);
  monthAgo.setDate(monthAgo.getDate() - 30);

  const todayTotals = sumByType(movements, today);
  const weekTotals = sumByType(movements, weekAgo);
  const monthTotals = sumByType(movements, monthAgo);
  const weekSalesRows = sales.filter((sale) => new Date(sale.created_at) >= weekAgo);
  const weekExpensesRows = expenses.filter((expense) => new Date(expense.created_at) >= weekAgo);
  const weekSalesTotal = weekSalesRows.reduce((sum, sale) => sum + sale.quantity * sale.unit_price, 0);
  const weekCost = weekSalesRows.reduce((sum, sale) => sum + sale.quantity * (sale.products?.cost_price ?? 0), 0);
  const weekExpensesTotal = weekExpensesRows.reduce((sum, expense) => sum + expense.amount, 0);
  const weekProfit = weekSalesTotal - weekCost - weekExpensesTotal;

  const lowStock = products.filter((p) => p.quantity <= p.reorder_level);
  const salesTotal = sales.reduce((sum, sale) => sum + sale.quantity * sale.unit_price, 0);
  const costOfGoods = sales.reduce(
    (sum, sale) => sum + sale.quantity * (sale.products?.cost_price ?? 0),
    0
  );
  const cashCollected = sales
    .filter((sale) => !sale.payment_method || sale.payment_method === 'cash')
    .reduce((sum, sale) => sum + sale.amount_paid, 0);
  const mpesaCollected = sales
    .filter((sale) => sale.payment_method === 'mpesa')
    .reduce((sum, sale) => sum + sale.amount_paid, 0);
  const bankCollected = sales
    .filter((sale) => sale.payment_method === 'bank')
    .reduce((sum, sale) => sum + sale.amount_paid, 0);
  const creditSalesBalance = sales
    .filter((sale) => sale.payment_method === 'credit')
    .reduce((sum, sale) => sum + Math.max(sale.quantity * sale.unit_price - sale.amount_paid, 0), 0);
  const totalCollected = cashCollected + mpesaCollected + bankCollected;
  const expensesTotal = expenses.reduce((sum, expense) => sum + expense.amount, 0);
  const openDebt = debts.reduce((sum, debt) => sum + Math.max(debt.amount - debt.amount_paid, 0), 0);
  const profit = salesTotal - costOfGoods - expensesTotal;
  const grossProfit = salesTotal - costOfGoods;
  const expectedClosingCash = cashCollected - expensesTotal;
  const expectedClosingTotal = expectedClosingCash + mpesaCollected + bankCollected;
  const inventoryValue = products.reduce(
    (sum, product) => sum + product.quantity * (product.cost_price ?? 0),
    0
  );
  const grossMargin = salesTotal > 0 ? (grossProfit / salesTotal) * 100 : 0;
  const netMargin = salesTotal > 0 ? (profit / salesTotal) * 100 : 0;
  const byBranch = branches.map((branch) => {
    const branchSales = sales.filter((sale) => sale.branch_id === branch.id);
    const branchExpenses = expenses.filter((expense) => expense.branch_id === branch.id);
    const branchSalesTotal = branchSales.reduce((sum, sale) => sum + sale.quantity * sale.unit_price, 0);
    const branchCost = branchSales.reduce(
      (sum, sale) => sum + sale.quantity * (sale.products?.cost_price ?? 0),
      0
    );
    const branchExpenseTotal = branchExpenses.reduce((sum, expense) => sum + expense.amount, 0);
    return {
      ...branch,
      salesTotal: branchSalesTotal,
      profit: branchSalesTotal - branchCost - branchExpenseTotal,
    };
  });
  const productSales = products
    .map((product) => {
      const productRows = sales.filter((sale) => sale.product_id === product.id);
      const quantitySold = productRows.reduce((sum, sale) => sum + sale.quantity, 0);
      const revenue = productRows.reduce((sum, sale) => sum + sale.quantity * sale.unit_price, 0);
      return { product, quantitySold, revenue };
    })
    .sort((a, b) => b.quantitySold - a.quantitySold);
  const fastMoving = productSales.filter((item) => item.quantitySold > 0).slice(0, 5);
  const slowMoving = productSales.filter((item) => item.quantitySold === 0).slice(0, 5);
  const topWeeklyItem = [...productSales].filter((item) => item.quantitySold > 0)[0];
  const expenseByCategory = expenses
    .reduce<{ category: string; amount: number }[]>((acc, expense) => {
      const category = expense.category?.trim() || 'Uncategorized';
      const existing = acc.find((row) => row.category === category);
      if (existing) existing.amount += expense.amount;
      else acc.push({ category, amount: expense.amount });
      return acc;
    }, [])
    .sort((a, b) => b.amount - a.amount);
  const biggestExpenseCategory = expenseByCategory[0];
  const reorderSuggestions = products
    .map((product) => {
      const sold = sales
        .filter((sale) => sale.product_id === product.id)
        .reduce((sum, sale) => sum + sale.quantity, 0);
      const weeklyVelocity = sold / 4.3;
      const targetStock = Math.max(product.reorder_level * 2, Math.ceil(weeklyVelocity * 2));
      const suggestedQty = Math.max(0, targetStock - product.quantity);
      return { product, sold, suggestedQty, weeklyVelocity };
    })
    .filter((item) => item.suggestedQty > 0 || item.product.quantity <= item.product.reorder_level)
    .sort((a, b) => b.suggestedQty - a.suggestedQty)
    .slice(0, 6);
  const profitByCategory = products
    .map((product) => {
      const categorySales = sales.filter((sale) => sale.product_id === product.id);
      const revenue = categorySales.reduce((sum, sale) => sum + sale.quantity * sale.unit_price, 0);
      const cost = categorySales.reduce(
        (sum, sale) => sum + sale.quantity * (sale.products?.cost_price ?? product.cost_price ?? 0),
        0
      );
      return {
        category: product.category ?? 'Uncategorized',
        revenue,
        profit: revenue - cost,
      };
    })
    .reduce<{ category: string; revenue: number; profit: number }[]>((acc, item) => {
      const existing = acc.find((row) => row.category === item.category);
      if (existing) {
        existing.revenue += item.revenue;
        existing.profit += item.profit;
      } else {
        acc.push(item);
      }
      return acc;
    }, [])
    .filter((item) => item.revenue > 0 || item.profit !== 0)
    .sort((a, b) => b.profit - a.profit);
  const exportStatement = () => {
    downloadCsv('financial-statement.csv', [
      ['Metric', 'Amount'],
      ['Sales Revenue', String(salesTotal)],
      ['Cost of Goods Sold', String(costOfGoods)],
      ['Gross Profit', String(grossProfit)],
      ['Operating Expenses', String(expensesTotal)],
      ['Net Profit', String(profit)],
      ['Total Collected', String(totalCollected)],
      ['Cash', String(cashCollected)],
      ['M-Pesa', String(mpesaCollected)],
      ['Bank', String(bankCollected)],
      ['Credit Balance', String(creditSalesBalance)],
      ['Accounts Receivable', String(openDebt)],
      ['Inventory Value', String(inventoryValue)],
      ['Gross Margin %', grossMargin.toFixed(1)],
      ['Net Margin %', netMargin.toFixed(1)],
    ]);
  };
  const exportSales = () =>
    downloadCsv('sales-export.csv', [
      ['sale_number', 'date', 'branch_id', 'product', 'customer', 'quantity', 'unit_price', 'amount_paid', 'payment_status'],
      ...sales.map((sale) => [
        sale.sale_number ?? sale.id.slice(0, 8).toUpperCase(),
        sale.created_at,
        sale.branch_id ?? '',
        sale.products?.name ?? sale.product_id,
        sale.customer_name ?? '',
        String(sale.quantity),
        String(sale.unit_price),
        String(sale.amount_paid),
        sale.payment_status,
      ]),
    ]);
  const exportStock = () =>
    downloadCsv('stock-export.csv', [
      ['branch_id', 'name', 'sku', 'category', 'quantity', 'reorder_level', 'cost_price', 'unit_price'],
      ...products.map((product) => [
        product.branch_id ?? '',
        product.name,
        product.sku ?? '',
        product.category ?? '',
        String(product.quantity),
        String(product.reorder_level),
        String(product.cost_price ?? 0),
        String(product.unit_price ?? 0),
      ]),
    ]);
  const exportDebts = () =>
    downloadCsv('debts-export.csv', [
      ['date', 'branch_id', 'customer', 'amount', 'amount_paid', 'balance', 'due_date', 'status'],
      ...debts.map((debt) => [
        debt.created_at,
        debt.branch_id ?? '',
        debt.customer_name,
        String(debt.amount),
        String(debt.amount_paid),
        String(Math.max(debt.amount - debt.amount_paid, 0)),
        debt.due_date ?? '',
        debt.status,
      ]),
    ]);
  const exportExpenses = () =>
    downloadCsv('expenses-export.csv', [
      ['date', 'branch_id', 'title', 'category', 'amount', 'receipt', 'note'],
      ...expenses.map((expense) => [
        expense.created_at,
        expense.branch_id ?? '',
        expense.title,
        expense.category ?? '',
        String(expense.amount),
        expense.receipt_file_name ?? (expense.receipt_storage_path || expense.receipt_data_url ? 'Attached' : ''),
        expense.note ?? '',
      ]),
    ]);
  const exportQuotations = () =>
    downloadCsv('quotations-export.csv', [
      ['date', 'branch_id', 'customer', 'contact', 'number', 'total_amount', 'status', 'valid_until'],
      ...quotations.map((quote) => [
        quote.created_at,
        quote.branch_id ?? '',
        quote.customer_name,
        quote.customer_contact ?? '',
        quote.quote_number ?? '',
        String(quote.total_amount),
        quote.status,
        quote.valid_until ?? '',
      ]),
    ]);
  const printPdfReport = () => {
    if (Platform.OS === 'web' && typeof window !== 'undefined') {
      window.print();
      return;
    }
    Alert.alert('PDF', 'Print/PDF inapatikana kwenye web preview kwa sasa.');
  };

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <View style={styles.branchFilters}>
          {branches.map((branch) => (
            <BranchFilterButton
              key={branch.id}
              label={branch.name}
              active={reportBranchId === branch.id}
              onPress={() => setReportBranchId(branch.id)}
            />
          ))}
          <BranchFilterButton
            label="Zote"
            active={reportBranchId === 'all'}
            onPress={() => setReportBranchId('all')}
          />
        </View>

        <Text style={styles.sectionTitle}>Leo</Text>
        <View style={styles.statsRow}>
          <StatCard label="Stock In" value={formatQuantity(todayTotals.in)} />
          <StatCard label="Stock Out" value={formatQuantity(todayTotals.out)} />
        </View>

        <Text style={styles.sectionTitle}>Biashara (siku 30)</Text>
        <View style={styles.statsRow}>
          <ReportStatButton label="Mauzo" value={`Tsh ${formatMoney(salesTotal)}`} onPress={() => setDetailType('sales')} />
          <ReportStatButton label="Malipo Yote" value={`Tsh ${formatMoney(totalCollected)}`} onPress={() => setDetailType('payments')} />
        </View>
        <View style={styles.statsRow}>
          <ReportStatButton label="Matumizi" value={`Tsh ${formatMoney(expensesTotal)}`} tone="danger" onPress={() => setDetailType('expenses')} />
          {isOwner ? (
            <ReportStatButton label="Gharama za Bidhaa" value={`Tsh ${formatMoney(costOfGoods)}`} onPress={() => setDetailType('cogs')} />
          ) : null}
        </View>
        <View style={styles.statsRow}>
          {isOwner ? (
            <ReportStatButton label="Faida" value={`Tsh ${formatMoney(profit)}`} tone={profit < 0 ? 'danger' : 'success'} onPress={() => setDetailType('profit')} />
          ) : null}
          <ReportStatButton label="Madeni Wazi" value={`Tsh ${formatMoney(openDebt)}`} onPress={() => setDetailType('debts')} />
        </View>
        <View style={styles.statsRow}>
          <ReportStatButton label="Bidhaa Pungufu" value={String(lowStock.length)} tone="danger" onPress={() => setDetailType('low_stock')} />
        </View>

        {isOwner ? (
          <>
            <Text style={styles.sectionTitle}>Owner Weekly Report</Text>
            <View style={styles.statementCard}>
              <StatementLine label="Weekly Sales" value={weekSalesTotal} />
              <StatementLine label="Weekly Expenses" value={weekExpensesTotal} negative />
              <StatementLine label="Weekly Profit" value={weekProfit} strong tone={weekProfit < 0 ? 'danger' : 'success'} />
              <StatementLine label="Open Debts" value={openDebt} />
              <StatementLine label="Low Stock Items" value={lowStock.length} />
              <View style={styles.statementDivider} />
              <Text style={styles.statementMeta}>
                Top item: {topWeeklyItem ? `${topWeeklyItem.product.name} (${formatQuantity(topWeeklyItem.quantitySold)} sold)` : 'Hakuna mauzo wiki hii'}
              </Text>
              {biggestExpenseCategory ? (
                <Text style={styles.statementMeta}>
                  Biggest expense: {biggestExpenseCategory.category} Tsh {formatMoney(biggestExpenseCategory.amount)}
                </Text>
              ) : null}
            </View>

            <Text style={styles.sectionTitle}>Financial Statement (siku 30)</Text>
            <View style={styles.statementCard}>
              <View style={styles.statementHeader}>
                <Text style={styles.statementHeading}>Income Statement</Text>
                <Pressable style={styles.exportButton} onPress={exportStatement}>
                  <Text style={styles.exportText}>Export CSV</Text>
                </Pressable>
              </View>
              <StatementLine label="Sales Revenue" value={salesTotal} />
              <StatementLine label="Cost of Goods Sold" value={costOfGoods} negative />
              <StatementLine label="Gross Profit" value={grossProfit} strong tone={grossProfit < 0 ? 'danger' : 'success'} />
              <StatementLine label="Operating Expenses" value={expensesTotal} negative />
              <StatementLine label="Net Profit" value={profit} strong tone={profit < 0 ? 'danger' : 'success'} />
              <View style={styles.statementDivider} />
              <Text style={styles.statementHeading}>Cash & Position</Text>
              <StatementLine label="Total Collected" value={totalCollected} />
              <StatementLine label="Cash" value={cashCollected} />
              <StatementLine label="M-Pesa" value={mpesaCollected} />
              <StatementLine label="Bank" value={bankCollected} />
              <StatementLine label="Credit Balance" value={creditSalesBalance} />
              <StatementLine label="Accounts Receivable" value={openDebt} />
              <StatementLine label="Inventory Value" value={inventoryValue} />
              <View style={styles.statementMetaRow}>
                <Text style={styles.statementMeta}>Gross Margin: {grossMargin.toFixed(1)}%</Text>
                <Text style={styles.statementMeta}>Net Margin: {netMargin.toFixed(1)}%</Text>
              </View>
            </View>
          </>
        ) : null}

        <Text style={styles.sectionTitle}>Payment Methods</Text>
        <View style={styles.paymentMethodCard}>
          <PaymentMethodRow label="Cash" amount={cashCollected} total={totalCollected} tone="success" />
          <PaymentMethodRow label="M-Pesa" amount={mpesaCollected} total={totalCollected} />
          <PaymentMethodRow label="Bank" amount={bankCollected} total={totalCollected} />
          <PaymentMethodRow label="Credit balance" amount={creditSalesBalance} total={salesTotal} tone="danger" />
        </View>

        {isOwner ? (
          <>
            <Text style={styles.sectionTitle}>Profit by Category</Text>
            <View style={styles.movingCard}>
              {profitByCategory.length === 0 ? (
                <Text style={styles.emptyText}>Hakuna mauzo ya category bado.</Text>
              ) : (
                profitByCategory.map((item) => (
                  <MovingItem
                    key={item.category}
                    name={item.category}
                    meta={`Revenue Tsh ${formatMoney(item.revenue)} | Profit Tsh ${formatMoney(item.profit)}`}
                  />
                ))
              )}
            </View>
          </>
        ) : null}

        <Text style={styles.sectionTitle}>Expense Categories</Text>
        <View style={styles.movingCard}>
          {expenseByCategory.length === 0 ? (
            <Text style={styles.emptyText}>Hakuna expenses kwenye kipindi hiki.</Text>
          ) : (
            expenseByCategory.map((item) => (
              <MovingItem
                key={item.category}
                name={item.category}
                meta={`Tsh ${formatMoney(item.amount)} | ${salesTotal > 0 ? ((item.amount / salesTotal) * 100).toFixed(1) : '0.0'}% ya mauzo`}
              />
            ))
          )}
        </View>

        <Text style={styles.sectionTitle}>Supplier Reorder Suggestions</Text>
        <View style={styles.movingCard}>
          {reorderSuggestions.length === 0 ? (
            <Text style={styles.emptyText}>Hakuna bidhaa inayohitaji reorder kwa sasa.</Text>
          ) : (
            reorderSuggestions.map((item) => (
              <MovingItem
                key={item.product.id}
                name={item.product.name}
                meta={`Agiza ${formatQuantity(item.suggestedQty)} ${item.product.unit} | Stock ${formatQuantity(item.product.quantity)} | Sold ${formatQuantity(item.sold)} siku 30`}
              />
            ))
          )}
        </View>

        <Text style={styles.sectionTitle}>Fast / Slow Moving Items</Text>
        <View style={styles.movingGrid}>
          <View style={styles.movingCard}>
            <Text style={styles.movingTitle}>Fast Moving</Text>
            {fastMoving.length === 0 ? (
              <Text style={styles.emptyText}>Hakuna mauzo bado.</Text>
            ) : (
              fastMoving.map((item) => (
                <MovingItem
                  key={item.product.id}
                  name={item.product.name}
                  meta={`${formatQuantity(item.quantitySold)} ${item.product.unit} | Tsh ${formatMoney(item.revenue)}`}
                />
              ))
            )}
          </View>
          <View style={styles.movingCard}>
            <Text style={styles.movingTitle}>Slow Moving</Text>
            {slowMoving.length === 0 ? (
              <Text style={styles.emptyText}>Bidhaa zote zimeuza ndani ya kipindi hiki.</Text>
            ) : (
              slowMoving.map((item) => (
                <MovingItem
                  key={item.product.id}
                  name={item.product.name}
                  meta={`${formatQuantity(item.product.quantity)} ${item.product.unit} stock`}
                />
              ))
            )}
          </View>
        </View>

        <Text style={styles.sectionTitle}>Daily Closing</Text>
        <View style={styles.statsRow}>
          <StatCard label="Closing Total" value={`Tsh ${formatMoney(expectedClosingTotal)}`} />
          <StatCard label="Tofauti ya Cash" value="Tsh 0" tone="success" />
        </View>

        {reportBranchId === 'all' ? (
          <>
            <Text style={styles.sectionTitle}>Linganisha Branches</Text>
            {byBranch.map((branch) => (
              <View key={branch.id} style={styles.branchRow}>
                <Text style={styles.branchName}>{branch.name}</Text>
                <View style={styles.branchNumbers}>
                  <Text style={styles.branchMetric}>Mauzo: Tsh {formatMoney(branch.salesTotal)}</Text>
                  {isOwner ? (
                    <Text style={[styles.branchMetric, branch.profit < 0 && styles.dangerText]}>
                      Faida: Tsh {formatMoney(branch.profit)}
                    </Text>
                  ) : null}
                </View>
              </View>
            ))}
            {isOwner ? <BranchPerformanceBars branches={byBranch} /> : null}
          </>
        ) : null}

        <Text style={styles.sectionTitle}>Wiki hii (siku 7)</Text>
        <View style={styles.statsRow}>
          <StatCard label="Stock In" value={formatQuantity(weekTotals.in)} />
          <StatCard label="Stock Out" value={formatQuantity(weekTotals.out)} />
        </View>

        <Text style={styles.sectionTitle}>Mwezi huu (siku 30)</Text>
        <View style={styles.statsRow}>
          <StatCard label="Stock In" value={formatQuantity(monthTotals.in)} />
          <StatCard label="Stock Out" value={formatQuantity(monthTotals.out)} />
        </View>

        <Text style={styles.sectionTitle}>Backup / Export Center</Text>
        <Text style={styles.exportIntro}>
          CSV hizi zinafunguka kwenye Excel. Tumia Print / PDF kuhifadhi summary ya ripoti kama PDF.
        </Text>
        <View style={styles.exportGrid}>
          <ExportTile label="Sales Excel" onPress={exportSales} />
          <ExportTile label="Stock Excel" onPress={exportStock} />
          <ExportTile label="Debts Excel" onPress={exportDebts} />
          <ExportTile label="Expenses Excel" onPress={exportExpenses} />
          {isOwner ? <ExportTile label="Statement Excel" onPress={exportStatement} /> : null}
          <ExportTile label="Quotations Excel" onPress={exportQuotations} />
          <ExportTile label="Print / PDF" onPress={printPdfReport} />
        </View>

        <Text style={styles.sectionTitle}>Ripoti ya Stock Pungufu ({lowStock.length})</Text>
        {lowStock.length === 0 ? (
          <Text style={styles.emptyText}>Hakuna bidhaa zenye stock pungufu kwa sasa.</Text>
        ) : (
          lowStock.map((product) => (
            <ProductListItem
              key={product.id}
              product={product}
              onPress={() => router.push(`/(tabs)/products/${product.id}`)}
            />
          ))
        )}
      </ScrollView>

      <ReportDetailModal
        visible={detailType !== null}
        type={detailType}
        onClose={() => setDetailType(null)}
        sales={sales}
        expenses={expenses}
        debts={debts}
        lowStock={lowStock}
        totals={{
          salesTotal,
          totalCollected,
          cashCollected,
          mpesaCollected,
          bankCollected,
          creditSalesBalance,
          expensesTotal,
          openDebt,
          costOfGoods,
          grossProfit,
          profit,
          grossMargin,
          netMargin,
        }}
      />
    </Screen>
  );
}

function ReportStatButton({
  label,
  value,
  tone = 'default',
  onPress,
}: {
  label: string;
  value: string;
  tone?: 'default' | 'danger' | 'success' | 'warning';
  onPress: () => void;
}) {
  return (
    <Pressable style={({ pressed }) => [styles.reportStatButton, pressed && styles.pressed]} onPress={onPress}>
      <StatCard label={label} value={value} tone={tone} />
      <Text style={styles.reportStatHint}>Bonyeza kuona yote</Text>
    </Pressable>
  );
}

function ReportDetailModal({
  visible,
  type,
  onClose,
  sales,
  expenses,
  debts,
  lowStock,
  totals,
}: {
  visible: boolean;
  type: ReportDetailType | null;
  onClose: () => void;
  sales: Sale[];
  expenses: Expense[];
  debts: Debt[];
  lowStock: Product[];
  totals: {
    salesTotal: number;
    totalCollected: number;
    cashCollected: number;
    mpesaCollected: number;
    bankCollected: number;
    creditSalesBalance: number;
    expensesTotal: number;
    openDebt: number;
    costOfGoods: number;
    grossProfit: number;
    profit: number;
    grossMargin: number;
    netMargin: number;
  };
}) {
  const [receiptPreview, setReceiptPreview] = useState<ReceiptPreview | null>(null);
  if (!type) return null;

  const previewExpenseReceipt = async (expense: Expense) => {
    if (expense.receipt_storage_path) {
      const { data, error } = await supabase.storage
        .from('expense-receipts')
        .createSignedUrl(expense.receipt_storage_path, 60 * 10);
      if (!error && data?.signedUrl) {
        setReceiptPreview({
          title: expense.receipt_file_name ?? 'Risiti ya matumizi',
          url: data.signedUrl,
          mimeType: expense.receipt_mime_type ?? null,
          message: null,
        });
        return;
      }
      setReceiptPreview({
        title: expense.receipt_file_name ?? 'Risiti ya matumizi',
        url: null,
        mimeType: expense.receipt_mime_type ?? null,
        message:
          error?.message.includes('Object not found') || expense.receipt_storage_path.startsWith('preview/')
            ? 'Hii ni demo/preview receipt, file halisi halipo Storage. Kwa matumizi halisi, picha itaonekana hapa.'
            : error?.message ?? 'Imeshindikana kufungua receipt kutoka Storage.',
      });
      return;
    }

    if (expense.receipt_data_url) {
      setReceiptPreview({
        title: expense.receipt_file_name ?? 'Risiti ya matumizi',
        url: expense.receipt_data_url,
        mimeType: expense.receipt_mime_type ?? null,
        message: null,
      });
      return;
    }

    setReceiptPreview({
      title: expense.receipt_file_name ?? 'Risiti ya matumizi',
      url: null,
      mimeType: expense.receipt_mime_type ?? null,
      message: expense.receipt_file_name
        ? `${expense.receipt_file_name} imeandikwa kwenye record, lakini file halisi halijapatikana.`
        : 'Matumizi haya hayana receipt attachment.',
    });
  };

  const titleMap: Record<ReportDetailType, string> = {
    sales: 'Mauzo yote - siku 30',
    payments: 'Malipo yote - siku 30',
    expenses: 'Matumizi yote - siku 30',
    debts: 'Madeni wazi',
    profit: 'Faida - siku 30',
    cogs: 'Gharama za bidhaa',
    low_stock: 'Bidhaa pungufu',
  };

  return (
    <>
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.detailOverlay}>
        <View style={styles.detailCard}>
          <View style={styles.detailHeader}>
            <View>
              <Text style={styles.detailEyebrow}>Biashara (siku 30)</Text>
              <Text style={styles.detailTitle}>{titleMap[type]}</Text>
            </View>
            <Pressable style={styles.detailClose} onPress={onClose}>
              <Text style={styles.detailCloseText}>X</Text>
            </Pressable>
          </View>

          <ScrollView style={styles.detailBody} contentContainerStyle={styles.detailBodyContent}>
            {type === 'sales' ? (
              <>
                <DetailSummaryGrid
                  rows={[
                    ['Mauzo yote', `Tsh ${formatMoney(totals.salesTotal)}`],
                    ['Transactions', String(sales.length)],
                    ['Qty sold', formatQuantity(sales.reduce((sum, sale) => sum + sale.quantity, 0))],
                  ]}
                />
                {sales.length === 0 ? <Text style={styles.emptyText}>Hakuna mauzo kipindi hiki.</Text> : null}
                {sales.map((sale) => (
                  <DetailRow
                    key={sale.id}
                    title={sale.products?.name ?? sale.product_id}
                    meta={`${formatQuantity(sale.quantity)} ${sale.products?.unit ?? ''} x Tsh ${formatMoney(sale.unit_price)} · ${formatDateTime(sale.created_at)}`}
                    amount={`Tsh ${formatMoney(sale.quantity * sale.unit_price)}`}
                  />
                ))}
              </>
            ) : null}

            {type === 'payments' ? (
              <>
                <DetailSummaryGrid
                  rows={[
                    ['Collected', `Tsh ${formatMoney(totals.totalCollected)}`],
                    ['Cash', `Tsh ${formatMoney(totals.cashCollected)}`],
                    ['M-Pesa', `Tsh ${formatMoney(totals.mpesaCollected)}`],
                    ['Bank', `Tsh ${formatMoney(totals.bankCollected)}`],
                    ['Credit balance', `Tsh ${formatMoney(totals.creditSalesBalance)}`],
                  ]}
                />
                {sales.map((sale) => (
                  <DetailRow
                    key={sale.id}
                    title={sale.customer_name || sale.products?.name || sale.sale_number || 'Sale'}
                    meta={`${sale.payment_method ?? 'cash'} · ${sale.payment_status} · ${formatDateTime(sale.created_at)}`}
                    amount={`Paid Tsh ${formatMoney(sale.amount_paid)}`}
                  />
                ))}
              </>
            ) : null}

            {type === 'expenses' ? (
              <>
                <DetailSummaryGrid
                  rows={[
                    ['Matumizi yote', `Tsh ${formatMoney(totals.expensesTotal)}`],
                    ['Records', String(expenses.length)],
                    ['With receipts', String(expenses.filter((expense) => expense.receipt_file_name || expense.receipt_storage_path || expense.receipt_data_url).length)],
                  ]}
                />
                {expenses.length === 0 ? <Text style={styles.emptyText}>Hakuna matumizi kipindi hiki.</Text> : null}
                {expenses.map((expense) => (
                  <View key={expense.id} style={styles.detailExpenseBlock}>
                    <DetailRow
                      title={expense.title}
                      meta={`${expense.category ?? 'Uncategorized'} · ${formatDateTime(expense.created_at)}${expense.note ? ` · ${expense.note}` : ''}`}
                      amount={`Tsh ${formatMoney(expense.amount)}`}
                      tone="danger"
                    />
                    {expense.receipt_storage_path || expense.receipt_data_url || expense.receipt_file_name ? (
                      <Pressable style={styles.detailReceiptButton} onPress={() => previewExpenseReceipt(expense)}>
                        <Text style={styles.detailReceiptButtonText}>
                          Fungua risiti{expense.receipt_file_name ? ` · ${expense.receipt_file_name}` : ''}
                        </Text>
                      </Pressable>
                    ) : (
                      <Text style={styles.detailNoReceiptText}>No receipt attached</Text>
                    )}
                  </View>
                ))}
              </>
            ) : null}

            {type === 'debts' ? (
              <>
                <DetailSummaryGrid
                  rows={[
                    ['Madeni wazi', `Tsh ${formatMoney(totals.openDebt)}`],
                    ['Customers', String(debts.length)],
                    ['Paid so far', `Tsh ${formatMoney(debts.reduce((sum, debt) => sum + debt.amount_paid, 0))}`],
                  ]}
                />
                {debts.length === 0 ? <Text style={styles.emptyText}>Hakuna madeni wazi.</Text> : null}
                {debts.map((debt) => (
                  <DetailRow
                    key={debt.id}
                    title={debt.customer_name}
                    meta={`${debt.status} · Due ${debt.due_date ?? 'haijawekwa'} · ${debt.description ?? 'Deni'}`}
                    amount={`Bal Tsh ${formatMoney(Math.max(debt.amount - debt.amount_paid, 0))}`}
                    tone="warning"
                  />
                ))}
              </>
            ) : null}

            {type === 'profit' ? (
              <>
                <DetailSummaryGrid
                  rows={[
                    ['Sales revenue', `Tsh ${formatMoney(totals.salesTotal)}`],
                    ['Cost of goods', `Tsh ${formatMoney(totals.costOfGoods)}`],
                    ['Gross profit', `Tsh ${formatMoney(totals.grossProfit)}`],
                    ['Expenses', `Tsh ${formatMoney(totals.expensesTotal)}`],
                    ['Net profit', `Tsh ${formatMoney(totals.profit)}`],
                    ['Margin', `${totals.netMargin.toFixed(1)}%`],
                  ]}
                />
                <Text style={styles.detailNote}>
                  Formula: Faida = Mauzo - Gharama za bidhaa - Matumizi. Gross margin {totals.grossMargin.toFixed(1)}%.
                </Text>
              </>
            ) : null}

            {type === 'cogs' ? (
              <>
                <DetailSummaryGrid
                  rows={[
                    ['Gharama za bidhaa', `Tsh ${formatMoney(totals.costOfGoods)}`],
                    ['Sales revenue', `Tsh ${formatMoney(totals.salesTotal)}`],
                    ['Gross profit', `Tsh ${formatMoney(totals.grossProfit)}`],
                  ]}
                />
                {sales.map((sale) => (
                  <DetailRow
                    key={sale.id}
                    title={sale.products?.name ?? sale.product_id}
                    meta={`${formatQuantity(sale.quantity)} pcs · Cost/unit Tsh ${formatMoney(sale.products?.cost_price ?? 0)}`}
                    amount={`Cost Tsh ${formatMoney(sale.quantity * (sale.products?.cost_price ?? 0))}`}
                  />
                ))}
              </>
            ) : null}

            {type === 'low_stock' ? (
              <>
                <DetailSummaryGrid
                  rows={[
                    ['Bidhaa pungufu', String(lowStock.length)],
                    ['Total stock', formatQuantity(lowStock.reduce((sum, product) => sum + product.quantity, 0))],
                  ]}
                />
                {lowStock.length === 0 ? <Text style={styles.emptyText}>Hakuna bidhaa pungufu.</Text> : null}
                {lowStock.map((product) => (
                  <DetailRow
                    key={product.id}
                    title={product.name}
                    meta={`${product.category ?? 'No category'} · reorder level ${formatQuantity(product.reorder_level)}`}
                    amount={`${formatQuantity(product.quantity)} ${product.unit}`}
                    tone="danger"
                  />
                ))}
              </>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
    <Modal
      visible={receiptPreview !== null}
      transparent
      animationType="fade"
      onRequestClose={() => setReceiptPreview(null)}>
      <View style={styles.receiptPreviewOverlay}>
        <View style={styles.receiptPreviewCard}>
          <View style={styles.detailHeader}>
            <View>
              <Text style={styles.detailEyebrow}>Receipt attachment</Text>
              <Text style={styles.detailTitle}>{receiptPreview?.title ?? 'Risiti'}</Text>
            </View>
            <Pressable style={styles.detailClose} onPress={() => setReceiptPreview(null)}>
              <Text style={styles.detailCloseText}>X</Text>
            </Pressable>
          </View>
          {receiptPreview?.url ? (
            receiptPreview.mimeType?.includes('pdf') ? (
              <View style={styles.receiptPdfBox}>
                <Text style={styles.detailNote}>Hii receipt ni PDF. Bonyeza hapa chini kuifungua kwenye tab mpya.</Text>
                <Pressable style={styles.detailReceiptButton} onPress={() => receiptPreview.url && openUrl(receiptPreview.url)}>
                  <Text style={styles.detailReceiptButtonText}>Fungua PDF</Text>
                </Pressable>
              </View>
            ) : (
              <>
                <Image source={{ uri: receiptPreview.url }} style={styles.receiptPreviewImage} resizeMode="contain" />
                <Pressable style={styles.receiptOpenExternal} onPress={() => receiptPreview.url && openUrl(receiptPreview.url)}>
                  <Text style={styles.detailReceiptButtonText}>Fungua tab mpya</Text>
                </Pressable>
              </>
            )
          ) : (
            <Text style={styles.detailNote}>{receiptPreview?.message ?? 'Receipt haijapatikana.'}</Text>
          )}
        </View>
      </View>
    </Modal>
    </>
  );
}

function DetailSummaryGrid({ rows }: { rows: [string, string][] }) {
  return (
    <View style={styles.detailSummaryGrid}>
      {rows.map(([label, value]) => (
        <View key={label} style={styles.detailSummaryCell}>
          <Text style={styles.detailSummaryValue}>{value}</Text>
          <Text style={styles.detailSummaryLabel}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

function DetailRow({
  title,
  meta,
  amount,
  tone,
}: {
  title: string;
  meta: string;
  amount: string;
  tone?: 'danger' | 'warning';
}) {
  return (
    <View style={styles.detailRow}>
      <View style={styles.detailRowInfo}>
        <Text style={styles.detailRowTitle}>{title}</Text>
        <Text style={styles.detailRowMeta}>{meta}</Text>
      </View>
      <Text style={[styles.detailRowAmount, tone === 'danger' && styles.dangerText, tone === 'warning' && styles.warningText]}>
        {amount}
      </Text>
    </View>
  );
}

function BranchPerformanceBars({
  branches,
}: {
  branches: { id: string; name: string; salesTotal: number; profit: number }[];
}) {
  const maxSales = Math.max(...branches.map((branch) => branch.salesTotal), 1);
  const maxProfit = Math.max(...branches.map((branch) => Math.abs(branch.profit)), 1);
  return (
    <View style={styles.performanceCard}>
      <Text style={styles.movingTitle}>Branch Performance</Text>
      {branches.map((branch) => (
        <View key={branch.id} style={styles.performanceRow}>
          <Text style={styles.performanceName}>{branch.name}</Text>
          <View style={styles.barTrack}>
            <View style={[styles.salesBar, { width: `${Math.max(4, (branch.salesTotal / maxSales) * 100)}%` }]} />
          </View>
          <Text style={styles.performanceValue}>Mauzo: Tsh {formatMoney(branch.salesTotal)}</Text>
          <View style={styles.barTrack}>
            <View
              style={[
                branch.profit < 0 ? styles.lossBar : styles.profitBar,
                { width: `${Math.max(4, (Math.abs(branch.profit) / maxProfit) * 100)}%` },
              ]}
            />
          </View>
          <Text style={styles.performanceValue}>Faida: Tsh {formatMoney(branch.profit)}</Text>
        </View>
      ))}
    </View>
  );
}

function MovingItem({ name, meta }: { name: string; meta: string }) {
  return (
    <View style={styles.movingItem}>
      <Text style={styles.movingName}>{name}</Text>
      <Text style={styles.movingMeta}>{meta}</Text>
    </View>
  );
}

function ExportTile({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable style={styles.exportTile} onPress={onPress}>
      <Text style={styles.exportTileText}>{label}</Text>
    </Pressable>
  );
}

function PaymentMethodRow({
  label,
  amount,
  total,
  tone,
}: {
  label: string;
  amount: number;
  total: number;
  tone?: 'danger' | 'success';
}) {
  const width = total > 0 ? Math.max(4, (amount / total) * 100) : 0;
  return (
    <View style={styles.paymentMethodRow}>
      <View style={styles.paymentMethodTop}>
        <Text style={styles.paymentMethodLabel}>{label}</Text>
        <Text
          style={[
            styles.paymentMethodValue,
            tone === 'success' && styles.successText,
            tone === 'danger' && styles.dangerText,
          ]}>
          Tsh {formatMoney(amount)}
        </Text>
      </View>
      <View style={styles.paymentTrack}>
        <View
          style={[
            styles.paymentFill,
            { width: `${width}%` },
            tone === 'success' && styles.paymentFillSuccess,
            tone === 'danger' && styles.paymentFillDanger,
          ]}
        />
      </View>
    </View>
  );
}

function StatementLine({
  label,
  value,
  negative = false,
  strong = false,
  tone,
}: {
  label: string;
  value: number;
  negative?: boolean;
  strong?: boolean;
  tone?: 'danger' | 'success';
}) {
  const displayValue = `${negative ? '-' : ''}Tsh ${formatMoney(value)}`;
  return (
    <View style={[styles.statementLine, strong && styles.statementLineStrong]}>
      <Text style={[styles.statementLabel, strong && styles.statementLabelStrong]}>{label}</Text>
      <Text
        style={[
          styles.statementValue,
          strong && styles.statementValueStrong,
          tone === 'danger' && styles.dangerText,
          tone === 'success' && styles.successText,
        ]}>
        {displayValue}
      </Text>
    </View>
  );
}

function BranchFilterButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Text onPress={onPress} style={[styles.branchFilter, active && styles.branchFilterActive]}>
      {label}
    </Text>
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
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
    marginTop: Spacing.lg,
    marginBottom: Spacing.md,
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
    color: Colors.textMuted,
    fontWeight: '600',
    overflow: 'hidden',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  branchFilterActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
    color: Colors.white,
  },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  reportStatButton: {
    flex: 1,
    position: 'relative',
  },
  reportStatHint: {
    position: 'absolute',
    right: Spacing.sm,
    bottom: Spacing.sm,
    color: Colors.primary,
    fontSize: 10,
    fontWeight: '400',
  },
  pressed: {
    opacity: 0.76,
  },
  emptyText: {
    color: Colors.textMuted,
    fontSize: 14,
  },
  statementCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
  },
  statementHeading: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  statementHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    marginBottom: Spacing.sm,
  },
  exportButton: {
    borderRadius: Radius.sm,
    backgroundColor: Colors.primarySoft,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  exportText: {
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '600',
  },
  exportGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  exportIntro: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 17,
    marginTop: -Spacing.sm,
  },
  exportTile: {
    flexBasis: '47%',
    flexGrow: 1,
    minHeight: 54,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  exportTileText: {
    color: Colors.primaryDark,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
  },
  statementLine: {
    minHeight: 36,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  statementLineStrong: {
    minHeight: 42,
  },
  statementLabel: {
    flex: 1,
    color: Colors.textMuted,
    fontWeight: '500',
  },
  statementLabelStrong: {
    color: Colors.text,
    fontWeight: '500',
  },
  statementValue: {
    color: Colors.text,
    fontWeight: '600',
    textAlign: 'right',
  },
  statementValueStrong: {
    fontSize: 15,
  },
  statementDivider: {
    height: Spacing.md,
  },
  statementMetaRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginTop: Spacing.md,
  },
  statementMeta: {
    flex: 1,
    color: Colors.primaryDark,
    backgroundColor: Colors.primarySoft,
    borderRadius: Radius.sm,
    overflow: 'hidden',
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    textAlign: 'center',
    fontWeight: '400',
  },
  movingGrid: {
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  movingCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  movingTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  movingItem: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.sm,
  },
  movingName: {
    color: Colors.text,
    fontWeight: '600',
  },
  movingMeta: {
    color: Colors.textMuted,
    marginTop: 2,
  },
  paymentMethodCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  paymentMethodRow: {
    gap: Spacing.xs,
  },
  paymentMethodTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  paymentMethodLabel: {
    flex: 1,
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: '500',
  },
  paymentMethodValue: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  paymentTrack: {
    height: 9,
    overflow: 'hidden',
    borderRadius: Radius.pill,
    backgroundColor: Colors.surfaceMuted,
  },
  paymentFill: {
    height: '100%',
    borderRadius: Radius.pill,
    backgroundColor: Colors.primary,
  },
  paymentFillSuccess: {
    backgroundColor: Colors.success,
  },
  paymentFillDanger: {
    backgroundColor: Colors.danger,
  },
  performanceCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginTop: Spacing.sm,
    gap: Spacing.md,
  },
  performanceRow: {
    gap: Spacing.xs,
  },
  performanceName: {
    color: Colors.text,
    fontWeight: '600',
  },
  performanceValue: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  barTrack: {
    height: 10,
    borderRadius: Radius.pill,
    overflow: 'hidden',
    backgroundColor: Colors.surfaceMuted,
  },
  salesBar: {
    height: '100%',
    backgroundColor: Colors.primary,
  },
  profitBar: {
    height: '100%',
    backgroundColor: Colors.success,
  },
  lossBar: {
    height: '100%',
    backgroundColor: Colors.danger,
  },
  permissionBox: {
    marginTop: Spacing.xl,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
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
    lineHeight: 20,
  },
  branchRow: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.sm,
    gap: Spacing.xs,
  },
  branchName: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  branchNumbers: {
    gap: 2,
  },
  branchMetric: {
    color: Colors.textMuted,
    fontWeight: '600',
  },
  dangerText: {
    color: Colors.danger,
  },
  successText: {
    color: Colors.success,
  },
  warningText: {
    color: Colors.warning,
  },
  detailOverlay: {
    flex: 1,
    backgroundColor: 'rgba(16, 34, 28, 0.48)',
    justifyContent: 'flex-end',
  },
  detailCard: {
    maxHeight: '88%',
    backgroundColor: Colors.surface,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    padding: Spacing.lg,
  },
  detailHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  detailEyebrow: {
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '400',
  },
  detailTitle: {
    color: Colors.text,
    fontSize: 20,
    fontWeight: '600',
    marginTop: 2,
  },
  detailClose: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: Colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailCloseText: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '600',
  },
  detailBody: {
    flexGrow: 0,
  },
  detailBodyContent: {
    paddingBottom: Spacing.xl,
    gap: Spacing.sm,
  },
  detailSummaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.sm,
  },
  detailSummaryCell: {
    flexBasis: '31%',
    flexGrow: 1,
    minHeight: 76,
    borderWidth: 1,
    borderColor: '#BFE8DA',
    borderRadius: Radius.md,
    backgroundColor: Colors.primarySoft,
    padding: Spacing.sm,
    justifyContent: 'center',
  },
  detailSummaryValue: {
    color: Colors.primaryDark,
    fontSize: 16,
    fontWeight: '600',
  },
  detailSummaryLabel: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '400',
    marginTop: 3,
  },
  detailRow: {
    minHeight: 64,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  detailRowInfo: {
    flex: 1,
  },
  detailRowTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  detailRowMeta: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    marginTop: 3,
    lineHeight: 16,
  },
  detailRowAmount: {
    color: Colors.primaryDark,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'right',
    maxWidth: 118,
  },
  detailExpenseBlock: {
    gap: Spacing.xs,
  },
  detailReceiptButton: {
    alignSelf: 'flex-start',
    borderRadius: Radius.sm,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: '#BFE8DA',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  detailReceiptButtonText: {
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '600',
  },
  detailNoReceiptText: {
    alignSelf: 'flex-start',
    color: Colors.danger,
    backgroundColor: '#FFF5F5',
    borderRadius: Radius.sm,
    overflow: 'hidden',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
    fontSize: 11,
    fontWeight: '400',
  },
  receiptPreviewOverlay: {
    flex: 1,
    backgroundColor: 'rgba(16, 34, 28, 0.58)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.lg,
  },
  receiptPreviewCard: {
    width: '100%',
    maxWidth: 560,
    maxHeight: '88%',
    borderRadius: 18,
    backgroundColor: Colors.surface,
    padding: Spacing.lg,
  },
  receiptPreviewImage: {
    width: '100%',
    height: 440,
    borderRadius: Radius.md,
    backgroundColor: Colors.surfaceMuted,
  },
  receiptOpenExternal: {
    alignSelf: 'center',
    marginTop: Spacing.md,
    borderRadius: Radius.sm,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: '#BFE8DA',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  receiptPdfBox: {
    gap: Spacing.md,
  },
  detailNote: {
    color: Colors.primaryDark,
    backgroundColor: Colors.primarySoft,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: '#BFE8DA',
    padding: Spacing.md,
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 19,
  },
});
