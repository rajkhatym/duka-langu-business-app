import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';
import { StatCard } from '@/components/stat-card';
import { Colors, Radius, Spacing } from '@/constants/colors';
import { isAnyPreviewMode, isOwnerPreviewMode, useAuth } from '@/lib/auth-context';
import { formatDateTime, formatMoney } from '@/lib/format';
import { useBranch } from '@/lib/branch-context';
import { getLocalPurchases } from '@/lib/local-purchases';
import { getLocalReportSales } from '@/lib/local-report-sales';
import { getPreviewData, getPreviewOperationCashSummary } from '@/lib/preview-data';
import { supabase } from '@/lib/supabase';
import { isMissingCostPriceError } from '@/lib/supabase-errors';
import type { Debt, Expense, OperationCashAuditEvent, OperationCashInjection, Purchase, Sale } from '@/types/database';

const OPERATION_CASH_MINIMUM = 100000;

type FinanceRow =
  | { kind: 'expense'; created_at: string; data: Expense }
  | { kind: 'debt'; created_at: string; data: Debt }
  | { kind: 'operation-cash'; created_at: string; data: OperationCashInjection };

type OperationCashSummary = {
  injected_total: number;
  expenses_total: number;
  balance: number;
};

function debtBalance(debt: Debt) {
  return Math.max(debt.amount - debt.amount_paid, 0);
}

function purchaseBalance(purchase: Purchase) {
  return Math.max(purchase.quantity * purchase.cost_price - purchase.amount_paid, 0);
}

async function openUrl(url: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) window.location.href = url;
    return;
  }
  await Linking.openURL(url);
}

function MiniMetric({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: number;
  tone?: 'default' | 'success' | 'danger';
}) {
  return (
    <View style={styles.miniMetric}>
      <Text style={styles.miniMetricLabel}>{label}</Text>
      <Text
        style={[
          styles.miniMetricValue,
          tone === 'success' && styles.successText,
          tone === 'danger' && styles.dangerText,
        ]}>
        Tsh {formatMoney(value)}
      </Text>
    </View>
  );
}

function StatementLine({
  label,
  value,
  negative = false,
  strong = false,
  tone = 'default',
}: {
  label: string;
  value: number;
  negative?: boolean;
  strong?: boolean;
  tone?: 'default' | 'success' | 'danger';
}) {
  return (
    <View style={[styles.statementLine, strong && styles.statementLineStrong]}>
      <Text style={[styles.statementLineLabel, strong && styles.statementLineLabelStrong]}>{label}</Text>
      <Text
        style={[
          styles.statementLineValue,
          strong && styles.statementLineValueStrong,
          tone === 'success' && styles.successText,
          tone === 'danger' && styles.dangerText,
        ]}>
        {negative ? '- ' : ''}
        Tsh {formatMoney(Math.abs(value))}
      </Text>
    </View>
  );
}

function FinanceTopAction({
  label,
  value,
  detail,
  tone = 'default',
  onPress,
}: {
  label: string;
  value: string;
  detail: string;
  tone?: 'default' | 'success' | 'danger';
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.topActionCard,
        tone === 'success' && styles.topActionCardSuccess,
        tone === 'danger' && styles.topActionCardDanger,
        pressed && styles.pressed,
      ]}
      onPress={onPress}>
      <Text
        style={[
          styles.topActionValue,
          tone === 'success' && styles.successText,
          tone === 'danger' && styles.dangerText,
        ]}>
        {value}
      </Text>
      <Text style={styles.topActionLabel}>{label}</Text>
      <Text style={styles.topActionDetail}>{detail}</Text>
    </Pressable>
  );
}

export default function FinanceScreen() {
  const { isAdmin, isOwner, profile } = useAuth();
  const { selectedBranch, selectedBranchId } = useBranch();
  const ownerPreviewMode = isOwnerPreviewMode();
  const previewMode = isAnyPreviewMode();
  const isCashier = profile?.role === 'cashier';
  const [period, setPeriod] = useState<'today' | 'month'>('month');
  const [sales, setSales] = useState<Sale[]>([]);
  const [purchases, setPurchases] = useState<Purchase[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [operationCashInjections, setOperationCashInjections] = useState<OperationCashInjection[]>([]);
  const [operationExpenseTotal, setOperationExpenseTotal] = useState(0);
  const [operationCashSummary, setOperationCashSummary] = useState<OperationCashSummary | null>(null);
  const [operationCashAudit, setOperationCashAudit] = useState<OperationCashAuditEvent[]>([]);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const monthAgo = new Date();
    monthAgo.setDate(monthAgo.getDate() - 30);
    const fromIso = monthAgo.toISOString();

    let [
      salesRes,
      expensesRes,
      debtsRes,
      purchasesRes,
      injectionsRes,
      operationExpensesRes,
      operationSummaryRes,
      operationAuditRes,
    ] = await Promise.all([
      supabase
        .from('sales')
        .select('*, products(id,name,unit,sku,cost_price,warranty_months)')
        .eq('branch_id', selectedBranchId)
        .gte('created_at', fromIso)
        .order('created_at', { ascending: false })
        .limit(300),
      supabase
        .from('expenses')
        .select('*')
        .eq('branch_id', selectedBranchId)
        .gte('created_at', fromIso)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('debts')
        .select('*, profiles(id,full_name)')
        .eq('branch_id', selectedBranchId)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase
        .from('purchases')
        .select('*, products(id,name,unit,sku)')
        .eq('branch_id', selectedBranchId)
        .gte('created_at', fromIso)
        .order('created_at', { ascending: false })
        .limit(200),
      supabase
        .from('operation_cash_injections')
        .select('*')
        .eq('branch_id', selectedBranchId)
        .order('created_at', { ascending: false })
        .limit(300),
      supabase
        .from('expenses')
        .select('amount')
        .eq('branch_id', selectedBranchId)
        .limit(1000),
      supabase.rpc('get_operation_cash_summary', { p_branch_id: selectedBranchId }),
      supabase.rpc('get_operation_cash_audit', { p_branch_id: selectedBranchId, p_limit: 8 }),
    ]);

    if (isMissingCostPriceError(salesRes.error)) {
      salesRes = await supabase
        .from('sales')
        .select('*, products(id,name,unit,sku,warranty_months)')
        .eq('branch_id', selectedBranchId)
        .gte('created_at', fromIso)
        .order('created_at', { ascending: false })
        .limit(300);
    }

    if (salesRes.error?.message.includes('branch_id')) {
      salesRes = await supabase
        .from('sales')
        .select('*, products(id,name,unit,sku,cost_price,warranty_months)')
        .gte('created_at', fromIso)
        .order('created_at', { ascending: false })
        .limit(300);
    }

    if (expensesRes.error?.message.includes('branch_id')) {
      expensesRes = await supabase
        .from('expenses')
        .select('*')
        .gte('created_at', fromIso)
        .order('created_at', { ascending: false })
        .limit(100);
    }
    if (expensesRes.error) {
      expensesRes = await supabase
        .from('expenses')
        .select('*')
        .eq('branch_id', selectedBranchId)
        .gte('created_at', fromIso)
        .order('created_at', { ascending: false })
        .limit(100);
    }

    if (operationExpensesRes.error?.message.includes('branch_id')) {
      operationExpensesRes = await supabase.from('expenses').select('amount').limit(1000);
    }

    if (debtsRes.error?.message.includes('branch_id')) {
      debtsRes = await supabase
        .from('debts')
        .select('*, profiles(id,full_name)')
        .order('created_at', { ascending: false })
        .limit(100);
    }

    if (purchasesRes.error?.message.includes('branch_id')) {
      purchasesRes = await supabase
        .from('purchases')
        .select('*, products(id,name,unit,sku)')
        .gte('created_at', fromIso)
        .order('created_at', { ascending: false })
        .limit(200);
    }

    if (injectionsRes.error?.message.includes('branch_id')) {
      injectionsRes = await supabase
        .from('operation_cash_injections')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(300);
    }

    let nextSales = (salesRes.data as unknown as Sale[]) ?? [];
    let nextPurchases = purchasesRes.error ? [] : ((purchasesRes.data as unknown as Purchase[]) ?? []);

    if (ownerPreviewMode) {
      const [localSales, localPurchases] = await Promise.all([
        getLocalReportSales(monthAgo, selectedBranchId),
        getLocalPurchases(selectedBranchId),
      ]);
      nextSales = [...localSales, ...nextSales];
      nextPurchases = [
        ...localPurchases.filter((purchase) => new Date(purchase.created_at) >= monthAgo),
        ...nextPurchases,
      ];
    }

    let nextExpenses = (expensesRes.data as unknown as Expense[]) ?? [];
    let nextInjections =
      injectionsRes.error ? [] : ((injectionsRes.data as unknown as OperationCashInjection[]) ?? [])
    ;
    let nextOperationExpenseTotal =
      operationExpensesRes.error
        ? 0
        : (((operationExpensesRes.data as unknown as Pick<Expense, 'amount'>[]) ?? []).reduce(
            (sum, expense) => sum + expense.amount,
            0
          ))
    ;
    const summaryRows = operationSummaryRes.error
      ? []
      : ((operationSummaryRes.data as unknown as OperationCashSummary[]) ?? []);
    let nextOperationCashSummary = summaryRows[0] ?? null;
    let nextOperationCashAudit =
      operationAuditRes.error ? [] : ((operationAuditRes.data as unknown as OperationCashAuditEvent[]) ?? []);
    let nextDebts = (debtsRes.data as unknown as Debt[]) ?? [];

    if (previewMode && nextSales.length + nextExpenses.length + nextPurchases.length + nextDebts.length === 0) {
      const preview = getPreviewData(selectedBranchId);
      nextSales = preview.sales;
      nextPurchases = preview.purchases;
      nextExpenses = preview.expenses;
      nextInjections = preview.operationCashInjections;
      nextOperationExpenseTotal = preview.expenses.reduce((sum, expense) => sum + expense.amount, 0);
      nextOperationCashSummary = getPreviewOperationCashSummary(selectedBranchId);
      nextOperationCashAudit = preview.operationCashAudit;
      nextDebts = preview.debts;
    }

    setSales(nextSales);
    setPurchases(nextPurchases);
    setExpenses(nextExpenses);
    setOperationCashInjections(nextInjections);
    setOperationExpenseTotal(nextOperationExpenseTotal);
    setOperationCashSummary(nextOperationCashSummary);
    setOperationCashAudit(nextOperationCashAudit);
    setDebts(nextDebts);
  }, [ownerPreviewMode, previewMode, selectedBranchId]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        setLoading(true);
        await load();
        if (active) setLoading(false);
      })();
      return () => {
        active = false;
      };
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const deleteExpense = async (expense: Expense) => {
    const deleteRecord = async () => {
      setNotice(null);

      if (expense.receipt_storage_path) {
        const { error: storageError } = await supabase.storage
          .from('expense-receipts')
          .remove([expense.receipt_storage_path]);

        if (storageError) {
          setNotice(`Receipt haijafutika Storage: ${storageError.message}`);
          return;
        }
      }

      const { error: deleteError } = await supabase.from('expenses').delete().eq('id', expense.id);
      if (deleteError) {
        setNotice(`Matumizi hayajafutika: ${deleteError.message}`);
        return;
      }

      setExpenses((current) => current.filter((item) => item.id !== expense.id));
      setNotice(
        expense.receipt_storage_path
          ? 'Matumizi yamefutwa pamoja na receipt file lake Storage.'
          : 'Matumizi yamefutwa.'
      );
    };

    if (Platform.OS === 'web') {
      const confirmed =
        typeof window !== 'undefined'
          ? window.confirm('Una hakika unataka kufuta matumizi haya? Receipt file lake Storage litafutwa pia.')
          : true;
      if (confirmed) await deleteRecord();
      return;
    }

    Alert.alert('Futa matumizi', 'Una hakika unataka kufuta matumizi haya? Receipt file lake Storage litafutwa pia.', [
      { text: 'Ghairi', style: 'cancel' },
      { text: 'Futa', style: 'destructive', onPress: deleteRecord },
    ]);
  };

  const rows: FinanceRow[] = [
    ...operationCashInjections.map((injection) => ({
      kind: 'operation-cash' as const,
      created_at: injection.created_at,
      data: injection,
    })),
    ...expenses.map((expense) => ({ kind: 'expense' as const, created_at: expense.created_at, data: expense })),
    ...debts.map((debt) => ({ kind: 'debt' as const, created_at: debt.created_at, data: debt })),
  ].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  const periodStart = new Date();
  if (period === 'today') {
    periodStart.setHours(0, 0, 0, 0);
  } else {
    periodStart.setDate(periodStart.getDate() - 30);
  }
  const periodLabel = period === 'today' ? 'Leo' : 'Siku 30';
  const periodSales = sales.filter((sale) => new Date(sale.created_at) >= periodStart);
  const periodExpenses = expenses.filter((expense) => new Date(expense.created_at) >= periodStart);
  const periodPurchases = purchases.filter((purchase) => new Date(purchase.created_at) >= periodStart);
  const periodDebts = debts.filter((debt) => new Date(debt.created_at) >= periodStart);
  const closingStart = new Date();
  closingStart.setHours(0, 0, 0, 0);
  const closingSales = sales.filter((sale) => new Date(sale.created_at) >= closingStart);
  const closingExpenses = expenses.filter((expense) => new Date(expense.created_at) >= closingStart);
  const cashierExpenseRows: FinanceRow[] = closingExpenses
    .map((expense) => ({ kind: 'expense' as const, created_at: expense.created_at, data: expense }))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
  const cashierTodayExpenseTotal = closingExpenses.reduce((sum, expense) => sum + expense.amount, 0);
  const closingSalesTotal = closingSales.reduce((sum, sale) => sum + sale.quantity * sale.unit_price, 0);
  const closingCashCollected = closingSales
    .filter((sale) => !sale.payment_method || sale.payment_method === 'cash')
    .reduce((sum, sale) => sum + sale.amount_paid, 0);
  const closingMpesaCollected = closingSales
    .filter((sale) => sale.payment_method === 'mpesa')
    .reduce((sum, sale) => sum + sale.amount_paid, 0);
  const closingBankCollected = closingSales
    .filter((sale) => sale.payment_method === 'bank')
    .reduce((sum, sale) => sum + sale.amount_paid, 0);
  const closingExpensesTotal = closingExpenses.reduce((sum, expense) => sum + expense.amount, 0);
  const closingExpectedCash = closingCashCollected - closingExpensesTotal;
  const closingExpectedTotal = closingExpectedCash + closingMpesaCollected + closingBankCollected;
  const closingCreditBalance = closingSales
    .filter((sale) => sale.payment_method === 'credit')
    .reduce((sum, sale) => sum + Math.max(sale.quantity * sale.unit_price - sale.amount_paid, 0), 0);
  const closingItemCount = closingSales.reduce((sum, sale) => sum + sale.quantity, 0);
  const salesRevenue = periodSales.reduce((sum, sale) => sum + sale.quantity * sale.unit_price, 0);
  const cashSales = periodSales.reduce((sum, sale) => sum + sale.amount_paid, 0);
  const paidSalesRevenue = periodSales
    .filter((sale) => sale.payment_status === 'paid')
    .reduce((sum, sale) => sum + sale.quantity * sale.unit_price, 0);
  const partialSalesRevenue = periodSales
    .filter((sale) => sale.payment_status === 'partial')
    .reduce((sum, sale) => sum + sale.quantity * sale.unit_price, 0);
  const creditSalesRevenue = periodSales
    .filter((sale) => sale.payment_status === 'credit')
    .reduce((sum, sale) => sum + sale.quantity * sale.unit_price, 0);
  const salesBalance = Math.max(salesRevenue - cashSales, 0);
  const customerCollections = periodDebts.reduce((sum, debt) => sum + debt.amount_paid, 0);
  const expenseTotal = periodExpenses.reduce((sum, expense) => sum + expense.amount, 0);
  const operationCashTotal =
    operationCashSummary?.injected_total ?? operationCashInjections.reduce((sum, injection) => sum + injection.amount, 0);
  const operationCashSpent = operationCashSummary?.expenses_total ?? operationExpenseTotal;
  const operationCashBalance = operationCashSummary?.balance ?? operationCashTotal - operationCashSpent;
  const operationCashLow = operationCashBalance < OPERATION_CASH_MINIMUM;
  const periodOperationCashIn = operationCashInjections
    .filter((injection) => new Date(injection.created_at) >= periodStart)
    .reduce((sum, injection) => sum + injection.amount, 0);
  const purchasePaidTotal = periodPurchases.reduce((sum, purchase) => sum + purchase.amount_paid, 0);
  const purchaseTotal = periodPurchases.reduce((sum, purchase) => sum + purchase.quantity * purchase.cost_price, 0);
  const costOfGoods = periodSales.reduce(
    (sum, sale) => sum + sale.quantity * (sale.products?.cost_price ?? 0),
    0
  );
  const grossProfit = salesRevenue - costOfGoods;
  const netProfit = grossProfit - expenseTotal;
  const cashIn = cashSales + customerCollections;
  const cashOut = expenseTotal + purchasePaidTotal;
  const netCashFlow = cashIn - cashOut;
  const grossMargin = salesRevenue > 0 ? (grossProfit / salesRevenue) * 100 : 0;
  const netMargin = salesRevenue > 0 ? (netProfit / salesRevenue) * 100 : 0;
  const debtTotal = debts.reduce((sum, debt) => sum + debtBalance(debt), 0);
  const periodReceivables = periodDebts.reduce((sum, debt) => sum + debtBalance(debt), 0);
  const supplierPayables = purchases.reduce((sum, purchase) => sum + purchaseBalance(purchase), 0);
  const periodSupplierPayables = periodPurchases.reduce((sum, purchase) => sum + purchaseBalance(purchase), 0);
  const topCustomerBalances = debts
    .reduce<{ name: string; amount: number }[]>((acc, debt) => {
      const balance = debtBalance(debt);
      if (balance <= 0) return acc;
      const existing = acc.find((item) => item.name === debt.customer_name);
      if (existing) existing.amount += balance;
      else acc.push({ name: debt.customer_name, amount: balance });
      return acc;
    }, [])
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 3);
  const topSupplierBalances = purchases
    .reduce<{ name: string; amount: number }[]>((acc, purchase) => {
      const balance = purchaseBalance(purchase);
      if (balance <= 0) return acc;
      const existing = acc.find((item) => item.name === purchase.supplier_name);
      if (existing) existing.amount += balance;
      else acc.push({ name: purchase.supplier_name, amount: balance });
      return acc;
    }, [])
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 3);
  const ownerDrawings = periodExpenses
    .filter((expense) => `${expense.category ?? ''} ${expense.title}`.toLowerCase().includes('owner'))
    .reduce((sum, expense) => sum + expense.amount, 0);
  const estimatedVatCollected = salesRevenue * 0.18;
  const estimatedVatOnPurchases = purchaseTotal * 0.18;
  const estimatedVatPayable = Math.max(estimatedVatCollected - estimatedVatOnPurchases, 0);
  const cashAccountBalance = netCashFlow;
  const collectionRate = salesRevenue > 0 ? (cashSales / salesRevenue) * 100 : 0;
  const paymentMixRows = [
    { label: 'Paid sales', amount: paidSalesRevenue, tone: 'success' as const },
    { label: 'Partial sales', amount: partialSalesRevenue, tone: 'warning' as const },
    { label: 'Credit sales', amount: creditSalesRevenue, tone: 'danger' as const },
  ];
  const cashPaymentTotal = periodSales
    .filter((sale) => !sale.payment_method || sale.payment_method === 'cash')
    .reduce((sum, sale) => sum + sale.amount_paid, 0);
  const mpesaPaymentTotal = periodSales
    .filter((sale) => sale.payment_method === 'mpesa')
    .reduce((sum, sale) => sum + sale.amount_paid, 0);
  const bankPaymentTotal = periodSales
    .filter((sale) => sale.payment_method === 'bank')
    .reduce((sum, sale) => sum + sale.amount_paid, 0);
  const creditPaymentBalance = periodSales
    .filter((sale) => sale.payment_method === 'credit')
    .reduce((sum, sale) => sum + Math.max(sale.quantity * sale.unit_price - sale.amount_paid, 0), 0);
  const salesTarget = period === 'today' ? 500000 : 5000000;
  const expenseBudget = period === 'today' ? 150000 : 1500000;
  const salesPace = salesTarget > 0 ? (salesRevenue / salesTarget) * 100 : 0;
  const expenseUsage = expenseBudget > 0 ? (expenseTotal / expenseBudget) * 100 : 0;
  const healthChecks = [
    { label: 'Cash flow', passed: netCashFlow >= 0 },
    { label: 'Profit margin', passed: netMargin >= 15 },
    { label: 'Collections', passed: collectionRate >= 85 || salesRevenue === 0 },
    { label: 'Expenses', passed: expenseTotal <= expenseBudget },
    { label: 'Supplier balance', passed: periodSupplierPayables <= periodReceivables + cashIn },
  ];
  const healthScore = Math.round((healthChecks.filter((check) => check.passed).length / healthChecks.length) * 100);
  const healthTone = healthScore >= 80 ? 'success' : healthScore >= 60 ? 'warning' : 'danger';
  const healthStatus =
    healthScore >= 80 ? 'Strong' : healthScore >= 60 ? 'Watch closely' : 'Needs attention';
  const expenseCategories = periodExpenses
    .reduce<{ category: string; amount: number }[]>((acc, expense) => {
      const category = expense.category?.trim() || 'Other';
      const existing = acc.find((item) => item.category === category);
      if (existing) existing.amount += expense.amount;
      else acc.push({ category, amount: expense.amount });
      return acc;
    }, [])
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 4);
  const today = new Date();
  const agingBuckets = periodDebts.reduce(
    (acc, debt) => {
      const balance = debtBalance(debt);
      if (balance <= 0) return acc;
      if (!debt.due_date) {
        acc.noDue += balance;
        return acc;
      }
      const due = new Date(`${debt.due_date}T00:00:00`);
      const days = Math.floor((today.getTime() - due.getTime()) / 86400000);
      if (days <= 7) acc.days0to7 += balance;
      else if (days <= 30) acc.days8to30 += balance;
      else if (days <= 60) acc.days31to60 += balance;
      else acc.days60plus += balance;
      return acc;
    },
    { days0to7: 0, days8to30: 0, days31to60: 0, days60plus: 0, noDue: 0 }
  );
  const topDebt = [...debts]
    .filter((debt) => debtBalance(debt) > 0)
    .sort((a, b) => debtBalance(b) - debtBalance(a))[0];
  const financeInsights = [
    netCashFlow < 0
      ? {
          title: 'Cash flow ipo negative',
          detail: `Cash imetoka zaidi ya ilivyoingia kwa Tsh ${formatMoney(Math.abs(netCashFlow))}. Kagua expenses na supplier payments.`,
          tone: 'danger' as const,
        }
      : {
          title: 'Cash flow iko sawa',
          detail: `Net cash flow ni Tsh ${formatMoney(netCashFlow)} kwa ${periodLabel.toLowerCase()}. Endelea kufuatilia collections.`,
          tone: 'success' as const,
        },
    periodReceivables > 0
      ? {
          title: 'Fuatilia madeni ya wateja',
          detail: topDebt
            ? `${topDebt.customer_name} ana balance kubwa: Tsh ${formatMoney(debtBalance(topDebt))}.`
            : `Customer balances zimefika Tsh ${formatMoney(periodReceivables)}.`,
          tone: 'warning' as const,
        }
      : {
          title: 'Hakuna receivable kubwa',
          detail: 'Madeni ya wateja hayajaonekana kwenye kipindi hiki.',
          tone: 'success' as const,
        },
    periodSupplierPayables > 0
      ? {
          title: 'Supplier balances',
          detail: `Unadaiwa na suppliers Tsh ${formatMoney(periodSupplierPayables)} kwenye ${periodLabel.toLowerCase()}.`,
          tone: 'warning' as const,
        }
      : {
          title: 'Supplier balance iko safi',
          detail: 'Hakuna supplier balance kubwa kwenye kipindi hiki.',
          tone: 'success' as const,
        },
    expenseTotal > expenseBudget
      ? {
          title: 'Expenses zimevuka budget',
          detail: `Matumizi yapo ${expenseUsage.toFixed(0)}% ya budget. Punguza au hakiki categories kubwa.`,
          tone: 'danger' as const,
        }
      : {
          title: 'Expenses zipo ndani ya budget',
          detail: `Matumizi yapo ${expenseUsage.toFixed(0)}% ya budget ya ${periodLabel.toLowerCase()}.`,
          tone: 'success' as const,
        },
    salesRevenue < salesTarget
      ? {
          title: 'Sales target bado',
          detail: `Mauzo yapo ${salesPace.toFixed(0)}% ya target. Angalia fast-moving items na quotation follow-up.`,
          tone: 'warning' as const,
        }
      : {
          title: 'Sales target imefikiwa',
          detail: `Mauzo yamefika ${salesPace.toFixed(0)}% ya target. Kagua profit margin na stock replenishment.`,
          tone: 'success' as const,
        },
  ];

  const exportFinanceCsv = () => {
    setNotice(null);
    const ownerRows = isOwner
      ? [
          ['Financial Health Score', 'Score', String(healthScore)],
          ['Financial Health Score', 'Status', healthStatus],
          ['Profit & Loss', 'Revenue', String(salesRevenue)],
          ['Profit & Loss', 'Cost of goods', String(costOfGoods)],
          ['Profit & Loss', 'Gross profit', String(grossProfit)],
          ['Profit & Loss', 'Expenses', String(expenseTotal)],
          ['Profit & Loss', 'Net profit', String(netProfit)],
        ]
      : [];
    const csvRows = [
      ['Section', 'Metric', 'Amount'],
      ...ownerRows,
      ['Cash Flow', 'Cash in', String(cashIn)],
      ['Cash Flow', 'Cash out', String(cashOut)],
      ['Cash Flow', 'Net cash flow', String(netCashFlow)],
      ['Operation Cash', 'Injected total', String(operationCashTotal)],
      ['Operation Cash', 'Expenses deducted', String(operationCashSpent)],
      ['Operation Cash', 'Balance', String(operationCashBalance)],
      ['Daily Closing Snapshot', 'Today sales', String(closingSalesTotal)],
      ['Daily Closing Snapshot', 'Today cash collected', String(closingCashCollected)],
      ['Daily Closing Snapshot', 'Today M-Pesa collected', String(closingMpesaCollected)],
      ['Daily Closing Snapshot', 'Today bank collected', String(closingBankCollected)],
      ['Daily Closing Snapshot', 'Today expenses', String(closingExpensesTotal)],
      ['Daily Closing Snapshot', 'Expected cash', String(closingExpectedCash)],
      ['Daily Closing Snapshot', 'Expected total', String(closingExpectedTotal)],
      ['Daily Closing Snapshot', 'Credit balance', String(closingCreditBalance)],
      ['Sales Payment Breakdown', 'Paid sales', String(paidSalesRevenue)],
      ['Sales Payment Breakdown', 'Partial sales', String(partialSalesRevenue)],
      ['Sales Payment Breakdown', 'Credit sales', String(creditSalesRevenue)],
      ['Sales Payment Breakdown', 'Sales collected', String(cashSales)],
      ['Sales Payment Breakdown', 'Sales balance', String(salesBalance)],
      ['Payment Methods', 'Cash', String(cashPaymentTotal)],
      ['Payment Methods', 'M-Pesa', String(mpesaPaymentTotal)],
      ['Payment Methods', 'Bank', String(bankPaymentTotal)],
      ['Payment Methods', 'Credit balance', String(creditPaymentBalance)],
      ['Receivables', 'Customer balances', String(periodReceivables)],
      ['Payables', 'Supplier balances', String(periodSupplierPayables)],
      ...topCustomerBalances.map((item) => ['Top Customer Balances', item.name, String(item.amount)]),
      ...topSupplierBalances.map((item) => ['Top Supplier Balances', item.name, String(item.amount)]),
      ['VAT estimate', 'VAT payable', String(estimatedVatPayable)],
    ];
    const csv = csvRows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(',')).join('\n');

    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `finance-${period}.csv`;
      link.click();
      URL.revokeObjectURL(link.href);
      setNotice('Finance CSV imeandaliwa. Download imeanza.');
      return;
    }

    setNotice('Export CSV inapatikana kwenye web preview.');
  };

  const copyReminder = async () => {
    setNotice(null);
    if (!topDebt) {
      setNotice('Hakuna deni wazi la kutuma reminder.');
      return;
    }
    const message = [
      `Habari ${topDebt.customer_name},`,
      `Kumbusho la balance yako: Tsh ${formatMoney(debtBalance(topDebt))}.`,
      topDebt.due_date ? `Due date: ${topDebt.due_date}` : null,
      topDebt.description ? `Maelezo: ${topDebt.description}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      try {
        await navigator.clipboard.writeText(message);
        setNotice('Reminder imenakiliwa.');
        return;
      } catch {
        setNotice(message);
        return;
      }
    }

    setNotice(message);
  };

  if (isCashier) {
    return (
      <Screen>
        <FlatList
          data={loading ? [] : cashierExpenseRows}
          keyExtractor={(item) => `${item.kind}-${item.data.id}`}
          contentContainerStyle={styles.list}
          refreshing={refreshing}
          onRefresh={onRefresh}
          renderItem={({ item }) => (
            <FinanceListItem
              item={item}
              canDeleteExpense={false}
              canReviewReceipts={false}
              onDeleteExpense={deleteExpense}
            />
          )}
          ListHeaderComponent={
            <View style={styles.header}>
              <View style={styles.cashierFinanceActions}>
                <Pressable
                  style={({ pressed }) => [styles.cashierFinancePrimary, pressed && styles.pressed]}
                  onPress={() => router.push('/(tabs)/sales/new' as Href)}>
                  <Text style={styles.cashierFinancePrimaryText}>Uza</Text>
                </Pressable>
                <Pressable
                  style={({ pressed }) => [styles.cashierFinanceSecondary, pressed && styles.pressed]}
                  onPress={() => router.push('/(tabs)/finance/new-expense' as Href)}>
                  <Text style={styles.cashierFinanceSecondaryText}>+ Matumizi</Text>
                </Pressable>
              </View>

              <View style={[styles.operationCashPanel, operationCashLow && styles.cashierFinanceDangerPanel]}>
                <View style={styles.operationCashTop}>
                  <View style={styles.operationCashTextWrap}>
                    <Text style={styles.operationCashTitle}>Operation Cash Balance</Text>
                    <Text style={styles.operationCashSubtitle}>
                      {selectedBranch?.name ?? selectedBranchId} · balance ya kuendesha duka
                    </Text>
                  </View>
                  <Text style={[styles.operationCashBalance, operationCashLow && styles.dangerText]}>
                    Tsh {formatMoney(operationCashBalance)}
                  </Text>
                </View>
                {operationCashLow ? (
                  <Text style={styles.operationCashWarning}>
                    Operation cash iko chini. Mjulisheni Manager/Owner kuongeza cash.
                  </Text>
                ) : null}
              </View>

              {notice ? <Text style={styles.notice}>{notice}</Text> : null}

              <View style={styles.statementPanel}>
                <View style={styles.statementTop}>
                  <View>
                    <Text style={styles.statementTitle}>Matumizi ya Leo</Text>
                    <Text style={styles.statementSubtitle}>
                      {cashierExpenseRows.length} record(s) · Tsh {formatMoney(cashierTodayExpenseTotal)}
                    </Text>
                  </View>
                </View>
              </View>
            </View>
          }
          ListEmptyComponent={
            loading ? (
              <View style={styles.loading}>
                <ActivityIndicator size="large" color={Colors.primary} />
              </View>
            ) : (
              <EmptyState
                title="Hakuna matumizi ya leo"
                subtitle="Cashier akijaza matumizi yataonekana hapa kwa kujiridhisha."
              />
            )
          }
        />
      </Screen>
    );
  }

  return (
    <Screen>
      <FlatList
        data={loading ? [] : rows}
        keyExtractor={(item) => `${item.kind}-${item.data.id}`}
        contentContainerStyle={styles.list}
        refreshing={refreshing}
          onRefresh={onRefresh}
          renderItem={({ item }) => (
            <FinanceListItem
              item={item}
              canDeleteExpense={isAdmin}
              canReviewReceipts={isAdmin}
              onDeleteExpense={deleteExpense}
            />
          )}
        ListHeaderComponent={
          <View style={styles.header}>
        {isAdmin ? (
          <>
            <View style={styles.topActionGrid}>
              <FinanceTopAction
                label="Expenses"
                value={`Tsh ${formatMoney(expenseTotal)}`}
                detail={`${periodLabel} matumizi`}
                tone="danger"
                onPress={() => router.push('/(tabs)/finance/new-expense' as Href)}
              />
              <FinanceTopAction
                label="Operation Cash"
                value={`Tsh ${formatMoney(operationCashBalance)}`}
                detail={operationCashLow ? 'Iko chini' : 'Balance'}
                tone={operationCashLow ? 'danger' : 'success'}
                onPress={() => router.push('/(tabs)/finance/operation-cash' as Href)}
              />
              <FinanceTopAction
                label="Mawinga"
                value={`Tsh ${formatMoney(debtTotal)}`}
                detail="Waliochukua mzigo kuuza"
                onPress={() => router.push('/(tabs)/finance/ledgers' as Href)}
              />
            </View>
            <Pressable
              style={styles.documentsTopButton}
              onPress={() => router.push('/(tabs)/documents' as Href)}>
              <View>
                <Text style={styles.documentsTopTitle}>Documents</Text>
                <Text style={styles.documentsTopSubtitle}>Quotations, Proforma na Invoices</Text>
              </View>
              <Text style={styles.documentsTopAction}>Fungua</Text>
            </Pressable>
          </>
        ) : null}

        <View style={styles.periodSwitch}>
          <Pressable
            style={[styles.periodButton, period === 'today' && styles.periodButtonActive]}
            onPress={() => setPeriod('today')}>
            <Text style={[styles.periodText, period === 'today' && styles.periodTextActive]}>Leo</Text>
          </Pressable>
          <Pressable
            style={[styles.periodButton, period === 'month' && styles.periodButtonActive]}
            onPress={() => setPeriod('month')}>
            <Text style={[styles.periodText, period === 'month' && styles.periodTextActive]}>Siku 30</Text>
          </Pressable>
        </View>

        <Pressable
          style={({ pressed }) => [styles.expensesListButton, pressed && styles.pressed]}
          onPress={() => router.push('/(tabs)/finance/expenses' as Href)}>
          <View style={styles.expensesListTextWrap}>
            <Text style={styles.expensesListTitle}>Matumizi yote</Text>
            <Text style={styles.expensesListSubtitle}>
              Fungua list kamili ya matumizi ya {selectedBranch?.name ?? selectedBranchId}
            </Text>
          </View>
          <View style={styles.expensesListAmountWrap}>
            <Text style={styles.expensesListAmount}>Tsh {formatMoney(expenseTotal)}</Text>
            <Text style={styles.expensesListCount}>
              {periodExpenses.length} record(s) · {periodLabel}
            </Text>
          </View>
        </Pressable>

        {notice ? <Text style={styles.notice}>{notice}</Text> : null}

        <View style={styles.statsRow}>
          <StatCard label="Matumizi" value={`Tsh ${formatMoney(expenseTotal)}`} tone="danger" />
          <StatCard label="Madeni Wazi" value={`Tsh ${formatMoney(debtTotal)}`} />
        </View>

        <View style={styles.operationCashPanel}>
          <View style={styles.operationCashTop}>
            <View style={styles.operationCashTextWrap}>
              <Text style={styles.operationCashTitle}>Operation Cash</Text>
              <Text style={styles.operationCashSubtitle}>
                Owner injection minus matumizi yote ya branch hii
              </Text>
            </View>
            <Text style={[styles.operationCashBalance, operationCashBalance < 0 && styles.dangerText]}>
              Tsh {formatMoney(operationCashBalance)}
            </Text>
          </View>
          <View style={styles.operationCashGrid}>
            <MiniMetric label="Injected total" value={operationCashTotal} tone="success" />
            <MiniMetric label="Expenses deducted" value={operationCashSpent} tone="danger" />
            <MiniMetric label={`${periodLabel} injection`} value={periodOperationCashIn} />
            <MiniMetric label={`${periodLabel} expenses`} value={expenseTotal} tone="danger" />
          </View>
          {operationCashLow ? (
            <Text style={styles.operationCashWarning}>
              Operation cash iko chini. Balance imefika chini ya Tsh {formatMoney(OPERATION_CASH_MINIMUM)}.
            </Text>
          ) : null}
          {isOwner ? (
            <Pressable
              style={styles.operationCashButton}
              onPress={() => router.push('/(tabs)/finance/operation-cash' as Href)}>
              <Text style={styles.operationCashButtonText}>+ Operation Cash</Text>
            </Pressable>
          ) : null}
        </View>

        {isAdmin ? (
          <View style={styles.statementPanel}>
            <View style={styles.statementTop}>
              <View>
                <Text style={styles.statementTitle}>Operation Cash Audit</Text>
                <Text style={styles.statementSubtitle}>
                  {selectedBranch?.name ?? selectedBranchId} · balance kabla/baada ya injection na expense
                </Text>
              </View>
            </View>
            {operationCashAudit.length === 0 ? (
              <Text style={styles.statementFootnote}>Hakuna movement ya operation cash bado.</Text>
            ) : (
              <View style={styles.auditCashList}>
                {operationCashAudit.map((event) => (
                  <View key={`${event.event_type}-${event.event_id}`} style={styles.auditCashRow}>
                    <View style={styles.auditCashTop}>
                      <Text style={styles.auditCashTitle}>
                        {event.event_type === 'injection' ? 'Injection' : 'Expense'} · {event.title}
                      </Text>
                      <Text style={[styles.auditCashAmount, event.event_type === 'expense' && styles.dangerText]}>
                        {event.event_type === 'expense' ? '-' : '+'} Tsh {formatMoney(event.amount)}
                      </Text>
                    </View>
                    <Text style={styles.auditCashMeta}>
                      {event.actor_name ?? event.actor_id?.slice(0, 8) ?? 'System'} · {selectedBranch?.name ?? event.branch_id ?? 'Branch'} · {formatDateTime(event.created_at)}
                    </Text>
                    <Text style={styles.auditCashBalance}>
                      Kabla Tsh {formatMoney(event.balance_before)} {'->'} Baada Tsh {formatMoney(event.balance_after)}
                    </Text>
                  </View>
                ))}
              </View>
            )}
          </View>
        ) : null}

        {isOwner ? (
          <>
            <View style={styles.statementPanel}>
              <View style={styles.statementTop}>
                <View>
                  <Text style={styles.statementTitle}>Financial Health Score</Text>
                  <Text style={styles.statementSubtitle}>Kipimo cha haraka cha cash, profit, collections na obligations</Text>
                </View>
                <Text
                  style={[
                    styles.healthScoreBadge,
                    healthTone === 'success' && styles.healthScoreSuccess,
                    healthTone === 'danger' && styles.healthScoreDanger,
                  ]}>
                  {healthScore}%
                </Text>
              </View>
              <View style={styles.healthTrack}>
                <View
                  style={[
                    styles.healthFill,
                    { width: `${healthScore}%` },
                    healthTone === 'success' && styles.healthFillSuccess,
                    healthTone === 'danger' && styles.healthFillDanger,
                  ]}
                />
              </View>
              <View style={styles.healthChecks}>
                {healthChecks.map((check) => (
                  <View key={check.label} style={styles.healthCheckRow}>
                    <Text style={[styles.healthCheckMark, check.passed ? styles.healthCheckGood : styles.healthCheckBad]}>
                      {check.passed ? 'OK' : 'Check'}
                    </Text>
                    <Text style={styles.healthCheckLabel}>{check.label}</Text>
                  </View>
                ))}
              </View>
              <Text style={styles.statementFootnote}>Status: {healthStatus}</Text>
            </View>

            <View style={styles.statementPanel}>
              <View style={styles.statementTop}>
                <View>
                  <Text style={styles.statementTitle}>Finance Action Center</Text>
                  <Text style={styles.statementSubtitle}>Vipaumbele vya owner kwa {periodLabel.toLowerCase()}</Text>
                </View>
              </View>
              <View style={styles.insightList}>
                {financeInsights.map((insight) => (
                  <View key={insight.title} style={styles.insightRow}>
                    <View
                      style={[
                        styles.insightDot,
                        insight.tone === 'success' && styles.insightDotSuccess,
                        insight.tone === 'danger' && styles.insightDotDanger,
                      ]}
                    />
                    <View style={styles.insightTextWrap}>
                      <Text style={styles.insightTitle}>{insight.title}</Text>
                      <Text style={styles.insightDetail}>{insight.detail}</Text>
                    </View>
                  </View>
                ))}
              </View>
            </View>
          </>
        ) : null}

        <View style={styles.statementPanel}>
          <View style={styles.statementTop}>
            <View>
              <Text style={styles.statementTitle}>Cash Flow</Text>
              <Text style={styles.statementSubtitle}>{periodLabel} · money in vs money out</Text>
            </View>
            <Text style={[styles.statementBadge, netCashFlow < 0 && styles.statementBadgeDanger]}>
              Tsh {formatMoney(netCashFlow)}
            </Text>
          </View>
          <View style={styles.statementGrid}>
            <MiniMetric label="Cash in" value={cashIn} tone="success" />
            <MiniMetric label="Cash out" value={cashOut} tone="danger" />
            <MiniMetric label="Sales paid" value={cashSales} />
            <MiniMetric label="Supplier paid" value={purchasePaidTotal} tone="danger" />
          </View>
        </View>

        <View style={styles.statementPanel}>
          <View style={styles.statementTop}>
            <View>
              <Text style={styles.statementTitle}>Daily Closing Snapshot</Text>
              <Text style={styles.statementSubtitle}>Leo · cash inayotakiwa kuhesabiwa dukani</Text>
            </View>
            <Text style={[styles.statementBadge, closingExpectedTotal < 0 && styles.statementBadgeDanger]}>
              Tsh {formatMoney(closingExpectedTotal)}
            </Text>
          </View>
          <View style={styles.statementGrid}>
            <MiniMetric label="Sales leo" value={closingSalesTotal} />
            <MiniMetric label="Cash expected" value={closingExpectedCash} tone={closingExpectedCash < 0 ? 'danger' : 'success'} />
            <MiniMetric label="M-Pesa" value={closingMpesaCollected} />
            <MiniMetric label="Bank" value={closingBankCollected} />
            <MiniMetric label="Expenses leo" value={closingExpensesTotal} tone="danger" />
            <MiniMetric label="Credit balance" value={closingCreditBalance} tone={closingCreditBalance > 0 ? 'danger' : 'success'} />
          </View>
          <View style={styles.closingChecklist}>
            <View style={styles.closingChecklistRow}>
              <Text style={styles.closingChecklistLabel}>Transactions</Text>
              <Text style={styles.closingChecklistValue}>{closingSales.length} sales · {closingItemCount} pcs</Text>
            </View>
            <View style={styles.closingChecklistRow}>
              <Text style={styles.closingChecklistLabel}>Closing action</Text>
              <Text style={styles.closingChecklistValue}>
                {closingExpectedCash < 0 ? 'Hakiki cash out' : 'Count cash, M-Pesa and Bank'}
              </Text>
            </View>
          </View>
          {isAdmin ? (
            <Pressable
              style={styles.inlineClosingButton}
              onPress={() => router.push('/(tabs)/finance/daily-closing' as Href)}>
              <Text style={styles.inlineClosingText}>Open Daily Closing</Text>
            </Pressable>
          ) : null}
        </View>

        <View style={styles.statementPanel}>
          <View style={styles.statementTop}>
            <View>
              <Text style={styles.statementTitle}>Sales Payment Breakdown</Text>
              <Text style={styles.statementSubtitle}>
                {periodLabel} · collected {collectionRate.toFixed(0)}% of sales
              </Text>
            </View>
            <Text style={[styles.statementBadge, salesBalance > 0 && styles.statementBadgeDanger]}>
              Balance Tsh {formatMoney(salesBalance)}
            </Text>
          </View>
          <View style={styles.statementLines}>
            {paymentMixRows.map((row) => {
              const width = salesRevenue > 0 ? Math.max(4, (row.amount / salesRevenue) * 100) : 0;
              return (
                <View key={row.label} style={styles.paymentMixRow}>
                  <View style={styles.paymentMixTop}>
                    <Text style={styles.paymentMixLabel}>{row.label}</Text>
                    <Text
                      style={[
                        styles.paymentMixAmount,
                        row.tone === 'success' && styles.successText,
                        row.tone === 'danger' && styles.dangerText,
                      ]}>
                      Tsh {formatMoney(row.amount)}
                    </Text>
                  </View>
                  <View style={styles.paymentTrack}>
                    <View
                      style={[
                        styles.paymentFill,
                        { width: `${width}%` },
                        row.tone === 'success' && styles.paymentFillSuccess,
                        row.tone === 'danger' && styles.paymentFillDanger,
                      ]}
                    />
                  </View>
                </View>
              );
            })}
          </View>
          <View style={styles.statementGrid}>
            <MiniMetric label="Sales collected" value={cashSales} tone="success" />
            <MiniMetric label="Uncollected sales" value={salesBalance} tone={salesBalance > 0 ? 'danger' : 'success'} />
          </View>
        </View>

        <View style={styles.statementPanel}>
          <View style={styles.statementTop}>
            <View>
              <Text style={styles.statementTitle}>Payment Methods</Text>
              <Text style={styles.statementSubtitle}>Cash, M-Pesa, Bank na Credit kwa {periodLabel.toLowerCase()}</Text>
            </View>
          </View>
          <View style={styles.statementGrid}>
            <MiniMetric label="Cash" value={cashPaymentTotal} tone="success" />
            <MiniMetric label="M-Pesa" value={mpesaPaymentTotal} />
            <MiniMetric label="Bank" value={bankPaymentTotal} />
            <MiniMetric label="Credit balance" value={creditPaymentBalance} tone={creditPaymentBalance > 0 ? 'danger' : 'success'} />
          </View>
        </View>

        {isOwner ? (
          <View style={styles.statementPanel}>
            <View style={styles.statementTop}>
              <View>
                <Text style={styles.statementTitle}>Profit & Loss</Text>
                <Text style={styles.statementSubtitle}>{periodLabel} · margin {netMargin.toFixed(1)}%</Text>
              </View>
              <Text style={[styles.statementBadge, netProfit < 0 && styles.statementBadgeDanger]}>
                Tsh {formatMoney(netProfit)}
              </Text>
            </View>
            <View style={styles.statementLines}>
              <StatementLine label="Revenue" value={salesRevenue} />
              <StatementLine label="Cost of goods" value={costOfGoods} negative />
              <StatementLine label="Gross profit" value={grossProfit} tone={grossProfit < 0 ? 'danger' : 'success'} />
              <StatementLine label="Expenses" value={expenseTotal} negative />
              <StatementLine label="Net profit" value={netProfit} strong tone={netProfit < 0 ? 'danger' : 'success'} />
            </View>
            <Text style={styles.statementFootnote}>
              Purchases recorded: Tsh {formatMoney(purchaseTotal)} · Gross margin {grossMargin.toFixed(1)}%
            </Text>
          </View>
        ) : null}

        <View style={styles.statementPanel}>
          <View style={styles.statementTop}>
            <View>
              <Text style={styles.statementTitle}>Receivables / Payables</Text>
              <Text style={styles.statementSubtitle}>Customer balances vs supplier balances</Text>
            </View>
            <Text style={[styles.statementBadge, periodReceivables - periodSupplierPayables < 0 && styles.statementBadgeDanger]}>
              Tsh {formatMoney(periodReceivables - periodSupplierPayables)}
            </Text>
          </View>
          <View style={styles.statementGrid}>
            <MiniMetric label="Customers owe" value={periodReceivables} />
            <MiniMetric label="Suppliers owed" value={periodSupplierPayables} tone="danger" />
            <MiniMetric label="All open debts" value={debtTotal} />
            <MiniMetric label="All supplier balances" value={supplierPayables} tone="danger" />
          </View>
        </View>

        <View style={styles.statementPanel}>
          <View style={styles.statementTop}>
            <View>
              <Text style={styles.statementTitle}>Top Balances</Text>
              <Text style={styles.statementSubtitle}>Nani anadaiwa zaidi na supplier gani apewe kipaumbele</Text>
            </View>
          </View>
          <View style={styles.balanceColumns}>
            <View style={styles.balanceColumn}>
              <Text style={styles.balanceColumnTitle}>Customers</Text>
              {topCustomerBalances.length === 0 ? (
                <Text style={styles.statementFootnote}>Hakuna customer balance wazi.</Text>
              ) : (
                topCustomerBalances.map((item) => (
                  <View key={item.name} style={styles.balanceRow}>
                    <Text style={styles.balanceName}>{item.name}</Text>
                    <Text style={styles.balanceAmount}>Tsh {formatMoney(item.amount)}</Text>
                  </View>
                ))
              )}
            </View>
            <View style={styles.balanceColumn}>
              <Text style={styles.balanceColumnTitle}>Suppliers</Text>
              {topSupplierBalances.length === 0 ? (
                <Text style={styles.statementFootnote}>Hakuna supplier balance wazi.</Text>
              ) : (
                topSupplierBalances.map((item) => (
                  <View key={item.name} style={styles.balanceRow}>
                    <Text style={styles.balanceName}>{item.name}</Text>
                    <Text style={styles.balanceAmountDanger}>Tsh {formatMoney(item.amount)}</Text>
                  </View>
                ))
              )}
            </View>
          </View>
        </View>

        <View style={styles.statementPanel}>
          <View style={styles.statementTop}>
            <View>
              <Text style={styles.statementTitle}>Aging Report</Text>
              <Text style={styles.statementSubtitle}>Madeni ya wateja kwa muda wa kuchelewa</Text>
            </View>
          </View>
          <View style={styles.statementGrid}>
            <MiniMetric label="0-7 days" value={agingBuckets.days0to7} />
            <MiniMetric label="8-30 days" value={agingBuckets.days8to30} />
            <MiniMetric label="31-60 days" value={agingBuckets.days31to60} tone="danger" />
            <MiniMetric label="60+ days" value={agingBuckets.days60plus} tone="danger" />
          </View>
          {agingBuckets.noDue > 0 ? (
            <Text style={styles.statementFootnote}>No due date: Tsh {formatMoney(agingBuckets.noDue)}</Text>
          ) : null}
        </View>

        <View style={styles.statementPanel}>
          <View style={styles.statementTop}>
            <View>
              <Text style={styles.statementTitle}>Tax / VAT Estimate</Text>
              <Text style={styles.statementSubtitle}>Estimate ya 18% kwa revenue na purchases</Text>
            </View>
            <Text style={[styles.statementBadge, estimatedVatPayable > 0 && styles.statementBadgeDanger]}>
              Tsh {formatMoney(estimatedVatPayable)}
            </Text>
          </View>
          <View style={styles.statementLines}>
            <StatementLine label="VAT collected estimate" value={estimatedVatCollected} />
            <StatementLine label="VAT on purchases estimate" value={estimatedVatOnPurchases} negative />
            <StatementLine label="Net VAT payable estimate" value={estimatedVatPayable} strong tone={estimatedVatPayable > 0 ? 'danger' : 'success'} />
          </View>
        </View>

        <View style={styles.statementPanel}>
          <View style={styles.statementTop}>
            <View>
              <Text style={styles.statementTitle}>Budget vs Actual</Text>
              <Text style={styles.statementSubtitle}>Targets za awali zinaweza kubadilishwa baadaye</Text>
            </View>
          </View>
          <View style={styles.statementGrid}>
            <MiniMetric label={`Sales target ${salesPace.toFixed(0)}%`} value={salesTarget} />
            <MiniMetric label="Actual sales" value={salesRevenue} tone={salesRevenue >= salesTarget ? 'success' : 'default'} />
            <MiniMetric label={`Expense budget ${expenseUsage.toFixed(0)}%`} value={expenseBudget} />
            <MiniMetric label="Actual expenses" value={expenseTotal} tone={expenseTotal > expenseBudget ? 'danger' : 'default'} />
          </View>
        </View>

        <View style={styles.statementPanel}>
          <View style={styles.statementTop}>
            <View>
              <Text style={styles.statementTitle}>Cash Accounts & Controls</Text>
              <Text style={styles.statementSubtitle}>Cash/Bank/Mobile money breakdown itaunganishwa kwenye payments</Text>
            </View>
          </View>
          <View style={styles.statementGrid}>
            <MiniMetric label="Cash account" value={cashAccountBalance} tone={cashAccountBalance < 0 ? 'danger' : 'success'} />
            <MiniMetric label="Owner drawings" value={ownerDrawings} tone="danger" />
          </View>
          <View style={styles.categoryList}>
            <Text style={styles.categoryTitle}>Expense categories</Text>
            {expenseCategories.length === 0 ? (
              <Text style={styles.statementFootnote}>Hakuna expense categories kwenye period hii.</Text>
            ) : (
              expenseCategories.map((item) => (
                <View key={item.category} style={styles.categoryRow}>
                  <Text style={styles.categoryName}>{item.category}</Text>
                  <Text style={styles.categoryAmount}>Tsh {formatMoney(item.amount)}</Text>
                </View>
              ))
            )}
          </View>
        </View>

        <View style={styles.actions}>
          <Pressable style={styles.secondaryActionButton} onPress={copyReminder}>
            <Text style={styles.secondaryActionText}>Copy Reminder</Text>
          </Pressable>
          <Pressable style={styles.secondaryActionButton} onPress={exportFinanceCsv}>
            <Text style={styles.secondaryActionText}>Export CSV</Text>
          </Pressable>
        </View>

        {isAdmin ? (
          <>
            <View style={styles.actions}>
              <Pressable style={styles.actionButton} onPress={() => router.push('/(tabs)/finance/new-debt' as Href)}>
                <Text style={styles.actionText}>+ Deni</Text>
              </Pressable>
            </View>
            <Pressable
              style={styles.closingButton}
              onPress={() => router.push('/(tabs)/finance/daily-closing' as Href)}>
              <Text style={styles.closingText}>Daily Closing</Text>
            </Pressable>
            <View style={styles.actions}>
              <Pressable
                style={styles.secondaryActionButton}
                onPress={() => router.push('/(tabs)/documents' as Href)}>
                <Text style={styles.secondaryActionText}>Documents</Text>
              </Pressable>
            </View>
            <View style={styles.actions}>
              <Pressable
                style={styles.secondaryActionButton}
                onPress={() => router.push('/(tabs)/finance/export' as Href)}>
                <Text style={styles.secondaryActionText}>Backup / Export</Text>
              </Pressable>
            </View>
          </>
        ) : null}
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.loading}>
              <ActivityIndicator size="large" color={Colors.primary} />
            </View>
          ) : (
            <EmptyState
              title="Hakuna kumbukumbu za Finance"
              subtitle="Rekodi matumizi au deni ili kuanza kuona mchanganuo."
            />
          )
        }
        />
    </Screen>
  );
}

function FinanceListItem({
  item,
  canDeleteExpense,
  canReviewReceipts,
  onDeleteExpense,
}: {
  item: FinanceRow;
  canDeleteExpense: boolean;
  canReviewReceipts: boolean;
  onDeleteExpense: (expense: Expense) => void;
}) {
  const openExpenseReceipt = async (expense: Expense) => {
    if (expense.receipt_storage_path) {
      const pendingWindow =
        Platform.OS === 'web' && typeof window !== 'undefined'
          ? window.open('', '_blank', 'noopener,noreferrer')
          : null;
      if (pendingWindow) {
        pendingWindow.document.write('<p style="font-family: system-ui; padding: 24px;">Inafungua risiti...</p>');
      }
      const { data, error } = await supabase.storage
        .from('expense-receipts')
        .createSignedUrl(expense.receipt_storage_path, 60 * 10);
      if (!error && data?.signedUrl) {
        if (pendingWindow) {
          pendingWindow.location.href = data.signedUrl;
        } else {
          await openUrl(data.signedUrl);
        }
        return;
      }
      pendingWindow?.close();
      Alert.alert(
        'Risiti haijafunguka',
        error?.message.includes('Object not found') || expense.receipt_storage_path.startsWith('preview/')
          ? 'Hii ni demo/preview receipt, file halisi halipo Storage. Kwa matumizi halisi, attachment itafunguka hapa.'
          : error?.message ?? 'Imeshindikana kufungua receipt kutoka Storage.'
      );
      return;
    }
    if (expense.receipt_data_url) {
      await openUrl(expense.receipt_data_url);
      return;
    }
    if (expense.receipt_file_name) {
      Alert.alert('Risiti', `${expense.receipt_file_name} imeandikwa kwenye record, lakini file halisi halijapatikana.`);
      return;
    }
    Alert.alert('Risiti', 'Matumizi haya hayana receipt attachment.');
  };

  if (item.kind === 'expense') {
    const hasReceipt = Boolean(item.data.receipt_storage_path || item.data.receipt_data_url || item.data.receipt_file_name);
    return (
      <View style={styles.row}>
        <View style={styles.rowTop}>
          <Text style={styles.title}>{item.data.title}</Text>
          <Text style={styles.expenseAmount}>- Tsh {formatMoney(item.data.amount)}</Text>
        </View>
        <View style={styles.expenseMetaRow}>
          <Text style={styles.meta}>{item.data.category ?? 'Matumizi'}</Text>
          {hasReceipt ? (
            <Text style={styles.receiptBadge}>Attached</Text>
          ) : canReviewReceipts ? (
            <Text style={styles.receiptMissingBadge}>No receipt</Text>
          ) : null}
        </View>
        {hasReceipt ? (
          <Pressable
            style={styles.receiptLink}
            onPress={() => openExpenseReceipt(item.data)}>
            <Text style={styles.receiptLinkText}>
              Fungua risiti{item.data.receipt_file_name ? ` · ${item.data.receipt_file_name}` : ''}
            </Text>
          </Pressable>
        ) : null}
        <View style={styles.rowFooter}>
          <Text style={styles.date}>{formatDateTime(item.data.created_at)}</Text>
          {canDeleteExpense ? (
            <Pressable style={styles.deleteExpenseButton} onPress={() => onDeleteExpense(item.data)}>
              <Text style={styles.deleteExpenseText}>Futa</Text>
            </Pressable>
          ) : null}
        </View>
      </View>
    );
  }

  if (item.kind === 'operation-cash') {
    return (
      <View style={styles.row}>
        <View style={styles.rowTop}>
          <Text style={styles.title}>Operation Cash Injection</Text>
          <Text style={styles.incomeAmount}>+ Tsh {formatMoney(item.data.amount)}</Text>
        </View>
        <Text style={styles.meta}>{item.data.note ?? 'Cash ya kuendesha branch'}</Text>
        <Text style={styles.date}>{formatDateTime(item.data.created_at)}</Text>
      </View>
    );
  }

  const balance = debtBalance(item.data);

  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <Text style={styles.title}>{item.data.customer_name}</Text>
        <Text style={styles.debtAmount}>Tsh {formatMoney(balance)}</Text>
      </View>
      <Text style={styles.meta}>
        Deni: Tsh {formatMoney(item.data.amount)} | Imelipwa: Tsh {formatMoney(item.data.amount_paid)}
      </Text>
      <Text style={styles.date}>
        {item.data.description ? `${item.data.description} | ` : ''}
        {formatDateTime(item.data.created_at)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
    gap: Spacing.md,
  },
  periodSwitch: {
    flexDirection: 'row',
    backgroundColor: Colors.primarySoft,
    borderRadius: Radius.md,
    padding: 4,
    gap: 4,
  },
  periodButton: {
    flex: 1,
    minHeight: 38,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  periodButtonActive: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  periodText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  periodTextActive: {
    color: Colors.primaryDark,
  },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  topActionGrid: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  topActionCard: {
    flex: 1,
    minHeight: 102,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    padding: Spacing.md,
    justifyContent: 'center',
    shadowColor: Colors.primaryDark,
    shadowOpacity: 0.06,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
    elevation: 2,
  },
  topActionCardSuccess: {
    borderColor: '#BFE8DA',
    backgroundColor: Colors.primarySoft,
  },
  topActionCardDanger: {
    borderColor: '#F4C7C7',
    backgroundColor: '#FFF5F5',
  },
  topActionValue: {
    color: Colors.primaryDark,
    fontSize: 15,
    fontWeight: '600',
  },
  topActionLabel: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '500',
    marginTop: 6,
  },
  topActionDetail: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '400',
    marginTop: 2,
  },
  cashierFinanceActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  cashierFinancePrimary: {
    flex: 1,
    minHeight: 58,
    borderRadius: Radius.md,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  cashierFinancePrimaryText: {
    color: Colors.white,
    fontSize: 18,
    fontWeight: '400',
  },
  cashierFinanceSecondary: {
    flex: 1,
    minHeight: 58,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  cashierFinanceSecondaryText: {
    color: Colors.primaryDark,
    fontSize: 16,
    fontWeight: '400',
  },
  cashierFinanceDangerPanel: {
    borderColor: '#F5C2C7',
    backgroundColor: '#FFF5F5',
  },
  documentsTopButton: {
    minHeight: 66,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: '#B9E5EF',
    backgroundColor: Colors.accentSoft,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  documentsTopTitle: {
    color: Colors.accent,
    fontSize: 16,
    fontWeight: '600',
  },
  documentsTopSubtitle: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
  documentsTopAction: {
    color: Colors.white,
    backgroundColor: Colors.accent,
    borderRadius: Radius.sm,
    overflow: 'hidden',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: 12,
    fontWeight: '600',
  },
  expensesListButton: {
    minHeight: 86,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: '#F4C7C7',
    backgroundColor: '#FFF5F5',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  expensesListTextWrap: {
    flex: 1,
    gap: 3,
  },
  expensesListTitle: {
    color: Colors.danger,
    fontSize: 17,
    fontWeight: '600',
  },
  expensesListSubtitle: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 17,
  },
  expensesListAmountWrap: {
    alignItems: 'flex-end',
    gap: 3,
  },
  expensesListAmount: {
    color: Colors.danger,
    fontSize: 15,
    fontWeight: '600',
    textAlign: 'right',
  },
  expensesListCount: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
    textAlign: 'right',
  },
  pressed: {
    opacity: 0.76,
  },
  notice: {
    borderRadius: Radius.md,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '400',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  statementPanel: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  operationCashPanel: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    borderRadius: Radius.md,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  operationCashTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  operationCashTextWrap: {
    flex: 1,
  },
  operationCashTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  operationCashSubtitle: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
  operationCashBalance: {
    color: Colors.primaryDark,
    fontSize: 16,
    fontWeight: '600',
    textAlign: 'right',
  },
  operationCashGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  operationCashWarning: {
    borderRadius: Radius.sm,
    backgroundColor: '#FFF8E6',
    color: Colors.warning,
    fontSize: 12,
    fontWeight: '400',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  operationCashButton: {
    minHeight: 42,
    borderRadius: Radius.md,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  operationCashButtonText: {
    color: Colors.white,
    fontSize: 13,
    fontWeight: '600',
  },
  auditCashList: {
    gap: Spacing.sm,
  },
  auditCashRow: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.sm,
    gap: 3,
  },
  auditCashTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  auditCashTitle: {
    flex: 1,
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  auditCashAmount: {
    color: Colors.success,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
  },
  auditCashMeta: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '400',
  },
  auditCashBalance: {
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '600',
  },
  statementTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  statementTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  statementSubtitle: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
  statementBadge: {
    overflow: 'hidden',
    borderRadius: Radius.pill,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    color: Colors.primaryDark,
    fontSize: 13,
    fontWeight: '600',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  statementBadgeDanger: {
    backgroundColor: '#FFF5F5',
    borderColor: '#F5C2C7',
    color: Colors.danger,
  },
  healthScoreBadge: {
    overflow: 'hidden',
    borderRadius: Radius.pill,
    backgroundColor: '#FFF8E6',
    borderWidth: 1,
    borderColor: '#F7D58A',
    color: Colors.warning,
    fontSize: 18,
    fontWeight: '600',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  healthScoreSuccess: {
    backgroundColor: Colors.primarySoft,
    borderColor: '#BFE5D6',
    color: Colors.primaryDark,
  },
  healthScoreDanger: {
    backgroundColor: '#FFF5F5',
    borderColor: '#F5C2C7',
    color: Colors.danger,
  },
  healthTrack: {
    height: 10,
    overflow: 'hidden',
    borderRadius: Radius.pill,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  healthFill: {
    height: '100%',
    borderRadius: Radius.pill,
    backgroundColor: Colors.warning,
  },
  healthFillSuccess: {
    backgroundColor: Colors.success,
  },
  healthFillDanger: {
    backgroundColor: Colors.danger,
  },
  healthChecks: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  healthCheckRow: {
    flexGrow: 1,
    minWidth: '47%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.xs,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.xs,
  },
  healthCheckMark: {
    minWidth: 40,
    overflow: 'hidden',
    borderRadius: Radius.pill,
    backgroundColor: '#FFF5F5',
    color: Colors.danger,
    fontSize: 10,
    fontWeight: '600',
    paddingHorizontal: Spacing.xs,
    paddingVertical: 3,
    textAlign: 'center',
  },
  healthCheckGood: {
    backgroundColor: Colors.primarySoft,
    color: Colors.primaryDark,
  },
  healthCheckBad: {
    backgroundColor: '#FFF5F5',
    color: Colors.danger,
  },
  healthCheckLabel: {
    flex: 1,
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  statementGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  insightList: {
    gap: Spacing.sm,
  },
  insightRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.sm,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.sm,
  },
  insightDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: Colors.warning,
    marginTop: 5,
  },
  insightDotSuccess: {
    backgroundColor: Colors.success,
  },
  insightDotDanger: {
    backgroundColor: Colors.danger,
  },
  insightTextWrap: {
    flex: 1,
    gap: 2,
  },
  insightTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  insightDetail: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 17,
  },
  miniMetric: {
    flexGrow: 1,
    minWidth: '47%',
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    padding: Spacing.md,
  },
  miniMetricLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  miniMetricValue: {
    color: Colors.primaryDark,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 2,
  },
  statementLines: {
    gap: Spacing.xs,
  },
  statementLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  statementLineStrong: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.sm,
    marginTop: Spacing.xs,
  },
  statementLineLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  statementLineLabelStrong: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '500',
  },
  statementLineValue: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  statementLineValueStrong: {
    color: Colors.primaryDark,
    fontSize: 14,
  },
  paymentMixRow: {
    gap: Spacing.xs,
  },
  paymentMixTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  paymentMixLabel: {
    flex: 1,
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  paymentMixAmount: {
    color: Colors.warning,
    fontSize: 12,
    fontWeight: '600',
  },
  paymentTrack: {
    height: 8,
    overflow: 'hidden',
    borderRadius: Radius.pill,
    backgroundColor: Colors.background,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  paymentFill: {
    height: '100%',
    borderRadius: Radius.pill,
    backgroundColor: Colors.warning,
  },
  paymentFillSuccess: {
    backgroundColor: Colors.success,
  },
  paymentFillDanger: {
    backgroundColor: Colors.danger,
  },
  closingChecklist: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.sm,
    gap: Spacing.xs,
  },
  closingChecklistRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  closingChecklistLabel: {
    flex: 1,
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  closingChecklistValue: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
  },
  inlineClosingButton: {
    minHeight: 42,
    borderRadius: Radius.md,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  inlineClosingText: {
    color: Colors.white,
    fontSize: 13,
    fontWeight: '400',
  },
  balanceColumns: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  balanceColumn: {
    flexGrow: 1,
    minWidth: '47%',
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    backgroundColor: Colors.background,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  balanceColumnTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: Spacing.xs,
  },
  balanceRow: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.xs,
    gap: 2,
  },
  balanceName: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  balanceAmount: {
    color: Colors.primaryDark,
    fontSize: 13,
    fontWeight: '600',
  },
  balanceAmountDanger: {
    color: Colors.danger,
    fontSize: 13,
    fontWeight: '600',
  },
  statementFootnote: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
  },
  categoryList: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.sm,
    gap: Spacing.xs,
  },
  categoryTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: Spacing.xs,
  },
  categoryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  categoryName: {
    flex: 1,
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  categoryAmount: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  successText: {
    color: Colors.success,
  },
  dangerText: {
    color: Colors.danger,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  actionButton: {
    flex: 1,
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionText: {
    color: Colors.white,
    fontWeight: '600',
  },
  closingButton: {
    height: 42,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.primary,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closingText: {
    color: Colors.primary,
    fontWeight: '400',
  },
  secondaryActionButton: {
    flex: 1,
    height: 42,
    borderRadius: Radius.md,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryActionText: {
    color: Colors.primaryDark,
    fontWeight: '600',
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    paddingBottom: Spacing.xxl,
  },
  row: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  title: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
  },
  expenseAmount: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.danger,
  },
  incomeAmount: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.success,
  },
  debtAmount: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.warning,
  },
  meta: {
    color: Colors.textMuted,
    marginTop: Spacing.xs,
  },
  expenseMetaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  receiptBadge: {
    overflow: 'hidden',
    borderRadius: Radius.pill,
    backgroundColor: Colors.primarySoft,
    color: Colors.primaryDark,
    fontSize: 10,
    fontWeight: '600',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
  },
  receiptMissingBadge: {
    overflow: 'hidden',
    borderRadius: Radius.pill,
    backgroundColor: '#FFF5F5',
    color: Colors.danger,
    fontSize: 10,
    fontWeight: '600',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
  },
  date: {
    color: Colors.textMuted,
    fontSize: 12,
    marginTop: Spacing.sm,
  },
  rowFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  deleteExpenseButton: {
    borderRadius: Radius.sm,
    borderWidth: 1,
    borderColor: Colors.danger,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
  },
  deleteExpenseText: {
    color: Colors.danger,
    fontSize: 12,
    fontWeight: '400',
  },
  receiptLink: {
    alignSelf: 'flex-start',
    marginTop: Spacing.sm,
    borderRadius: Radius.sm,
    backgroundColor: Colors.primarySoft,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  receiptLinkText: {
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '600',
  },
});
