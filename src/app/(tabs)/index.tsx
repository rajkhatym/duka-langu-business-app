import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { AppIcon, type AppIconName } from '@/components/app-icon';
import { Screen } from '@/components/screen';
import { Colors, Spacing } from '@/constants/colors';
import { formatDateTime, formatMoney, formatQuantity } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import { isMissingCostPriceError } from '@/lib/supabase-errors';
import { getLocalStoreLogBookEntries } from '@/lib/local-store-log-book';
import { isAnyPreviewMode, isCashierPreviewMode, isManagerPreviewMode, isOwnerPreviewMode, useAuth } from '@/lib/auth-context';
import { useBranch } from '@/lib/branch-context';
import { getPendingSalesCount, syncPendingSales } from '@/lib/offline-sales';
import { getPreviewData, getPreviewOperationCashSummary } from '@/lib/preview-data';
import { getSetupWizardState } from '@/lib/setup-wizard';
import type { AuditLog, DailyClosing, Debt, Expense, Product, Quotation, Sale, StoreLogBookEntry, WingaCustomer } from '@/types/database';

const OPERATION_CASH_MINIMUM = 100000;

const homeIcon = (ios: AppIconName['ios'], android: string, web: string): AppIconName => ({ ios, android, web });

const HomeIcons = {
  menu: homeIcon('line.3.horizontal' as AppIconName['ios'], 'menu', 'menu'),
  bell: homeIcon('bell.fill' as AppIconName['ios'], 'notifications', 'notifications'),
  store: homeIcon('storefront.fill' as AppIconName['ios'], 'storefront', 'storefront'),
  globe: homeIcon('globe' as AppIconName['ios'], 'language', 'language'),
  search: homeIcon('magnifyingglass' as AppIconName['ios'], 'search', 'search'),
  filter: homeIcon('slider.horizontal.3' as AppIconName['ios'], 'tune', 'tune'),
  cart: homeIcon('cart.fill', 'shopping_cart', 'shopping_cart'),
  stock: homeIcon('shippingbox.fill', 'inventory_2', 'inventory_2'),
  people: homeIcon('person.2.fill' as AppIconName['ios'], 'groups', 'groups'),
  person: homeIcon('person.fill' as AppIconName['ios'], 'person', 'person'),
  wallet: homeIcon('wallet.pass.fill', 'account_balance_wallet', 'account_balance_wallet'),
  cashPlus: homeIcon('plus.circle.fill' as AppIconName['ios'], 'add_circle', 'add_circle'),
  documents: homeIcon('doc.text.fill', 'description', 'description'),
  logBook: homeIcon('list.clipboard.fill' as AppIconName['ios'], 'assignment', 'assignment'),
  settings: homeIcon('gearshape.fill' as AppIconName['ios'], 'settings', 'settings'),
  trend: homeIcon('chart.line.uptrend.xyaxis' as AppIconName['ios'], 'trending_up', 'trending_up'),
  send: homeIcon('arrow.right' as AppIconName['ios'], 'arrow_forward', 'arrow_forward'),
  chevron: homeIcon('chevron.right' as AppIconName['ios'], 'chevron_right', 'chevron_right'),
  orders: homeIcon('bag.fill' as AppIconName['ios'], 'shopping_bag', 'shopping_bag'),
} as const;

type OperationCashSummary = {
  injected_total: number;
  expenses_total: number;
  balance: number;
};

type CashierTodayExpense = {
  id: string;
  branch_id: string | null;
  title: string;
  category: string | null;
  amount: number;
  receipt_file_name: string | null;
  has_receipt: boolean;
  created_by: string | null;
  actor_name: string | null;
  created_at: string;
};

type BranchWatchRow = {
  branchId: string;
  name: string;
  todaySales: number;
  cashExpected: number;
  lowStock: number;
  dueDebts: number;
  pendingQuotes: number;
};

type FastMoverRow = {
  productId: string | null;
  name: string;
  quantity: number;
  revenue: number;
  unit: string;
};

type StockRiskRow = {
  productId: string;
  name: string;
  quantity: number;
  unit: string;
  soldSevenDays: number;
  daysCover: number;
};

type HomeSectionKey = 'commandCenter' | 'documentPipeline' | 'fastMovers' | 'stockRisk';

type RecentActivityItem = {
  key: string;
  title: string;
  detail: string;
  amount?: string;
  tone: 'success' | 'warning' | 'danger' | 'default';
  createdAt: string;
  href?: Href;
};

type AiInsight = {
  title: string;
  detail: string;
  tone: 'success' | 'warning' | 'danger';
  href: Href;
};

type AiReorderSuggestion = {
  productId: string;
  name: string;
  quantity: number;
  unit: string;
  reason: string;
};

type AiAskExample = {
  label: string;
  question: string;
  icon: AppIconName;
  fallback: string;
};

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function daysSince(date: string) {
  return Math.max(0, Math.floor((new Date().getTime() - new Date(date).getTime()) / 86400000));
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function auditActionLabel(log: AuditLog) {
  const action = log.action === 'INSERT' ? 'Ameongeza' : log.action === 'UPDATE' ? 'Amebadili' : log.action === 'DELETE' ? 'Amefuta' : log.action;
  return `${action} ${log.table_name}`;
}

export default function DashboardScreen() {
  const { profile, isAdmin, isOwner, signOut } = useAuth();
  const { branches, selectedBranch, selectedBranchId, setSelectedBranchId } = useBranch();
  const [showAllBranches, setShowAllBranches] = useState(false);
  const dashboardBranchId = isOwner && showAllBranches ? null : selectedBranchId;
  const dashboardBranch =
    dashboardBranchId === null ? null : branches.find((branch) => branch.id === dashboardBranchId) ?? selectedBranch;
  const dashboardBranchName = dashboardBranchId === null ? 'All branches' : (dashboardBranch?.name ?? 'Branch');
  const previewMode = isAnyPreviewMode();
  const previewQuery = isOwnerPreviewMode()
    ? '?owner=preview'
    : isManagerPreviewMode()
      ? '?manager=preview'
      : isCashierPreviewMode()
        ? '?cashier=preview'
        : '';
  const storeLogBookHref = `/(tabs)/movements/log-book${previewQuery}` as Href;
  const [products, setProducts] = useState<Product[]>([]);
  const [sales, setSales] = useState<Sale[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [mawinga, setMawinga] = useState<WingaCustomer[]>([]);
  const [quotations, setQuotations] = useState<Quotation[]>([]);
  const [todayClosing, setTodayClosing] = useState<DailyClosing | null>(null);
  const [branchWatchRows, setBranchWatchRows] = useState<BranchWatchRow[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [branchOpen, setBranchOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [globalSearch, setGlobalSearch] = useState('');
  const [aiQuestion, setAiQuestion] = useState('');
  const [aiSubmittedQuestion, setAiSubmittedQuestion] = useState('');
  const [offlinePendingCount, setOfflinePendingCount] = useState(0);
  const [syncingOffline, setSyncingOffline] = useState(false);
  const [setupCompleted, setSetupCompleted] = useState(true);
  const [operationCashSummary, setOperationCashSummary] = useState<OperationCashSummary | null>(null);
  const [cashierTodayExpenses, setCashierTodayExpenses] = useState<CashierTodayExpense[]>([]);
  const [pendingStoreLogCount, setPendingStoreLogCount] = useState(0);
  const [expandedSections, setExpandedSections] = useState<Record<HomeSectionKey, boolean>>({
    commandCenter: false,
    documentPipeline: false,
    fastMovers: false,
    stockRisk: false,
  });

  const toggleSection = (section: HomeSectionKey) => {
    setExpandedSections((current) => ({ ...current, [section]: !current[section] }));
  };

  const load = useCallback(async () => {
    const monthAgo = new Date();
    monthAgo.setDate(monthAgo.getDate() - 30);

    let productsQuery = supabase.from('products').select('*').order('name');
    let salesQuery = supabase
      .from('sales')
      .select('*, products(id,name,unit,sku,cost_price)')
      .gte('created_at', monthAgo.toISOString());
    let expensesQuery = supabase.from('expenses').select('*').gte('created_at', monthAgo.toISOString());
    let debtsQuery = supabase.from('debts').select('*').neq('status', 'paid');
    let mawingaQuery = supabase
      .from('mawinga')
      .select('*')
      .eq('status', 'active')
      .order('created_at', { ascending: false });
    let closingQuery = supabase
      .from('daily_closings')
      .select('*')
      .eq('closing_date', todayIsoDate());
    let quotationsQuery = supabase
      .from('quotations')
      .select('*')
      .in('status', ['draft', 'sent', 'accepted'])
      .order('created_at', { ascending: false });
    let storeLogQuery = supabase
      .from('store_log_book')
      .select('id,branch_id,status')
      .eq('status', 'pending')
      .limit(50);
    const buildAuditQuery = () =>
      supabase
        .from('audit_logs')
        .select('*, profiles(id,full_name)')
        .gte('created_at', startOfDay(new Date()).toISOString())
        .order('created_at', { ascending: false })
        .limit(5);

    if (dashboardBranchId) {
      productsQuery = productsQuery.eq('branch_id', dashboardBranchId);
      salesQuery = salesQuery.eq('branch_id', dashboardBranchId);
      expensesQuery = expensesQuery.eq('branch_id', dashboardBranchId);
      debtsQuery = debtsQuery.eq('branch_id', dashboardBranchId);
      mawingaQuery = mawingaQuery.eq('branch_id', dashboardBranchId);
      closingQuery = closingQuery.eq('branch_id', dashboardBranchId);
      quotationsQuery = quotationsQuery.eq('branch_id', dashboardBranchId);
      storeLogQuery = storeLogQuery.eq('branch_id', dashboardBranchId);
    }

    let [productsRes, salesRes, expensesRes, debtsRes, mawingaRes, closingRes, quotationsRes, auditRes, storeLogRes] = await Promise.all([
      productsQuery,
      salesQuery,
      expensesQuery,
      debtsQuery,
      mawingaQuery,
      closingQuery.maybeSingle(),
      quotationsQuery,
      buildAuditQuery(),
      storeLogQuery,
    ]);

    if (productsRes.error?.message.includes('branch_id')) {
      [productsRes, salesRes, expensesRes, debtsRes, mawingaRes, closingRes, quotationsRes, auditRes, storeLogRes] = await Promise.all([
        supabase.from('products').select('*').order('name'),
        supabase
          .from('sales')
          .select('*, products(id,name,unit,sku,cost_price)')
          .gte('created_at', monthAgo.toISOString()),
        supabase.from('expenses').select('*').gte('created_at', monthAgo.toISOString()),
        supabase.from('debts').select('*').neq('status', 'paid'),
        supabase.from('mawinga').select('*').eq('status', 'active').order('created_at', { ascending: false }),
        supabase.from('daily_closings').select('*').eq('closing_date', todayIsoDate()).maybeSingle(),
        supabase
          .from('quotations')
          .select('*')
          .in('status', ['draft', 'sent', 'accepted'])
          .order('created_at', { ascending: false }),
        buildAuditQuery(),
        supabase.from('store_log_book').select('id,branch_id,status').eq('status', 'pending').limit(50),
      ]);
    }

    if (isMissingCostPriceError(salesRes.error)) {
      salesRes = await supabase
        .from('sales')
        .select('*, products(id,name,unit,sku)')
        .gte('created_at', monthAgo.toISOString());
    }

    let nextProducts = (productsRes.data as Product[]) ?? [];
    let nextSales = (salesRes.data as Sale[]) ?? [];
    let nextExpenses = (expensesRes.data as Expense[]) ?? [];
    let nextDebts = (debtsRes.data as Debt[]) ?? [];
    let nextMawinga = mawingaRes.error ? [] : ((mawingaRes.data as WingaCustomer[]) ?? []);
    let nextQuotations = quotationsRes.error ? [] : ((quotationsRes.data as Quotation[]) ?? []);
    let nextPendingStoreLogCount = storeLogRes.error
      ? 0
      : (((storeLogRes.data as Pick<StoreLogBookEntry, 'id'>[]) ?? []).length);
    let previewCashierExpenses: CashierTodayExpense[] | null = null;

    if (previewMode && nextProducts.length + nextSales.length + nextExpenses.length + nextDebts.length === 0) {
      const preview = getPreviewData(dashboardBranchId);
      nextProducts = preview.products;
      nextSales = preview.sales;
      nextExpenses = preview.expenses;
      nextDebts = preview.debts;
      nextQuotations = preview.quotations;
      nextPendingStoreLogCount = (await getLocalStoreLogBookEntries(dashboardBranchId)).filter(
        (entry) => (entry.status ?? 'pending') === 'pending'
      ).length;
      previewCashierExpenses = preview.expenses
        .filter((expense) => new Date(expense.created_at) >= startOfDay(new Date()))
        .map((expense) => ({
          id: expense.id,
          branch_id: expense.branch_id ?? null,
          title: expense.title,
          category: expense.category,
          amount: expense.amount,
          receipt_file_name: expense.receipt_file_name ?? null,
          has_receipt: Boolean(expense.receipt_storage_path || expense.receipt_data_url || expense.receipt_file_name),
          created_by: expense.created_by,
          actor_name: expense.profiles?.full_name ?? null,
          created_at: expense.created_at,
        }));
    }

    if (previewMode) {
      const localPendingStoreLogCount = (await getLocalStoreLogBookEntries(dashboardBranchId)).filter(
        (entry) => (entry.status ?? 'pending') === 'pending'
      ).length;
      nextPendingStoreLogCount = Math.max(nextPendingStoreLogCount, localPendingStoreLogCount);
    }

    setProducts(nextProducts);
    setSales(nextSales);
    setExpenses(nextExpenses);
    setDebts(nextDebts);
    setMawinga(nextMawinga);
    setTodayClosing(closingRes.error ? null : ((closingRes.data as DailyClosing | null) ?? null));
    setQuotations(nextQuotations);
    setAuditLogs(auditRes.error ? [] : ((auditRes.data as unknown as AuditLog[]) ?? []));
    setPendingStoreLogCount(nextPendingStoreLogCount);
    setOfflinePendingCount(await getPendingSalesCount());
    setSetupCompleted((await getSetupWizardState()).completed);
    const { data: operationCashData } = await supabase.rpc('get_operation_cash_summary', {
      p_branch_id: dashboardBranchId,
    });
    const operationCashRows = (operationCashData as OperationCashSummary[] | null) ?? [];
    setOperationCashSummary(
      previewMode && operationCashRows.length === 0
        ? getPreviewOperationCashSummary(dashboardBranchId)
        : (operationCashRows[0] ?? null)
    );
    const { data: cashierExpenseData } = await supabase.rpc('get_cashier_today_expenses', {
      p_branch_id: dashboardBranchId,
      p_from: startOfDay(new Date()).toISOString(),
    });
    setCashierTodayExpenses(previewCashierExpenses ?? ((cashierExpenseData as CashierTodayExpense[] | null) ?? []));

    if (!isAdmin || branches.length <= 1) {
      setBranchWatchRows([]);
      return;
    }

    const todayIso = startOfDay(new Date()).toISOString();
    const [allProductsRes, todaySalesRes, todayExpensesRes, allDebtsRes, allQuotesRes] = await Promise.all([
      supabase.from('products').select('id,branch_id,quantity,reorder_level'),
      supabase.from('sales').select('id,branch_id,quantity,unit_price,amount_paid,payment_method,created_at').gte('created_at', todayIso),
      supabase.from('expenses').select('id,branch_id,amount,created_at').gte('created_at', todayIso),
      supabase.from('debts').select('*').neq('status', 'paid'),
      supabase.from('quotations').select('*').in('status', ['draft', 'sent', 'accepted']),
    ]);

    if (allProductsRes.error?.message.includes('branch_id')) {
      setBranchWatchRows([]);
      return;
    }

    const allProducts = (allProductsRes.data as Pick<Product, 'branch_id' | 'quantity' | 'reorder_level'>[]) ?? [];
    const allTodaySales =
      (todaySalesRes.data as Pick<Sale, 'branch_id' | 'quantity' | 'unit_price' | 'amount_paid' | 'payment_method' | 'created_at'>[]) ??
      [];
    const allTodayExpenses = (todayExpensesRes.data as Pick<Expense, 'branch_id' | 'amount' | 'created_at'>[]) ?? [];
    const allDebts = (allDebtsRes.data as Debt[]) ?? [];
    const allQuotes = allQuotesRes.error ? [] : ((allQuotesRes.data as Quotation[]) ?? []);

    setBranchWatchRows(
      branches.map((branch) => {
        const branchSales = allTodaySales.filter((sale) => sale.branch_id === branch.id);
        const branchExpenses = allTodayExpenses.filter((expense) => expense.branch_id === branch.id);
        const cashCollected = branchSales
          .filter((sale) => (sale.payment_method ?? 'cash') === 'cash')
          .reduce((sum, sale) => sum + sale.amount_paid, 0);
        const expenseTotal = branchExpenses.reduce((sum, expense) => sum + expense.amount, 0);
        const branchDebts = allDebts.filter((debt) => debt.branch_id === branch.id);
        const dueDebtCount = branchDebts.filter((debt) => {
          if (Math.max(debt.amount - debt.amount_paid, 0) <= 0) return false;
          if (!debt.due_date) return daysSince(debt.created_at) >= 7;
          return new Date(debt.due_date) <= new Date();
        }).length;

        return {
          branchId: branch.id,
          name: branch.name,
          todaySales: branchSales.reduce((sum, sale) => sum + sale.quantity * sale.unit_price, 0),
          cashExpected: cashCollected - expenseTotal,
          lowStock: allProducts.filter((product) => product.branch_id === branch.id && product.quantity <= product.reorder_level).length,
          dueDebts: dueDebtCount,
          pendingQuotes: allQuotes.filter((quote) => quote.branch_id === branch.id).length,
        };
      })
    );
  }, [branches, dashboardBranchId, isAdmin, previewMode]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        setLoading(true);
        try {
          await load();
        } catch {
          if (previewMode) {
            const preview = getPreviewData(dashboardBranchId);
            setProducts(preview.products);
            setSales(preview.sales);
            setExpenses(preview.expenses);
            setDebts(preview.debts);
            setMawinga([]);
            setQuotations(preview.quotations);
            setPendingStoreLogCount(
              (await getLocalStoreLogBookEntries(dashboardBranchId)).filter(
                (entry) => (entry.status ?? 'pending') === 'pending'
              ).length
            );
            setOperationCashSummary(getPreviewOperationCashSummary(dashboardBranchId));
            setCashierTodayExpenses(
              preview.expenses
                .filter((expense) => new Date(expense.created_at) >= startOfDay(new Date()))
                .map((expense) => ({
                  id: expense.id,
                  branch_id: expense.branch_id ?? null,
                  title: expense.title,
                  category: expense.category,
                  amount: expense.amount,
                  receipt_file_name: expense.receipt_file_name ?? null,
                  has_receipt: Boolean(expense.receipt_storage_path || expense.receipt_data_url || expense.receipt_file_name),
                  created_by: expense.created_by,
                  actor_name: expense.profiles?.full_name ?? null,
                  created_at: expense.created_at,
                }))
            );
          }
        } finally {
          if (active) setLoading(false);
        }
      })();
      return () => {
        active = false;
      };
    }, [dashboardBranchId, load, previewMode])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const syncOfflineNow = async () => {
    setSyncingOffline(true);
    const result = await syncPendingSales({ force: true });
    setSyncingOffline(false);
    setOfflinePendingCount(result.remaining);
  };

  const totalUnits = products.reduce((sum, p) => sum + p.quantity, 0);
  const lowStock = products.filter((p) => p.quantity <= p.reorder_level);
  const globalSearchQuery = globalSearch.trim().toLowerCase();
  const globalResults = globalSearchQuery
    ? [
        ...products
          .filter((product) =>
            [product.name, product.sku, product.category, product.variant_size, product.variant_color, product.variant_weight]
              .filter(Boolean)
              .join(' ')
              .toLowerCase()
              .includes(globalSearchQuery)
          )
          .slice(0, 5)
          .map((product) => ({
            key: `product-${product.id}`,
            title: product.name,
            meta: `${product.sku ?? 'No SKU'} · Stock ${formatQuantity(product.quantity)} ${product.unit}`,
            href: `/(tabs)/products/${product.id}` as Href,
          })),
        ...debts
          .filter((debt) =>
            [debt.customer_name, debt.description, debt.status].filter(Boolean).join(' ').toLowerCase().includes(globalSearchQuery)
          )
          .slice(0, 4)
          .map((debt) => ({
            key: `debt-${debt.id}`,
            title: debt.customer_name,
            meta: `Deni TZS ${formatMoney(Math.max(debt.amount - debt.amount_paid, 0))}`,
            href: '/(tabs)/finance/ledgers' as Href,
          })),
        ...quotations
          .filter((quote) =>
            [quote.customer_name, quote.customer_contact, quote.quote_number, quote.status]
              .filter(Boolean)
              .join(' ')
              .toLowerCase()
              .includes(globalSearchQuery)
          )
          .slice(0, 4)
          .map((quote) => ({
            key: `quote-${quote.id}`,
            title: quote.customer_name,
            meta: `${quote.quote_number ?? 'Document'} · TZS ${formatMoney(quote.total_amount)} · ${quote.status}`,
            href: '/(tabs)/finance/quotations' as Href,
          })),
        ...sales
          .filter((sale) =>
            [sale.customer_name, sale.products?.name, sale.products?.sku, sale.payment_status]
              .filter(Boolean)
              .join(' ')
              .toLowerCase()
              .includes(globalSearchQuery)
          )
          .slice(0, 4)
          .map((sale) => ({
            key: `sale-${sale.id}`,
            title: sale.products?.name ?? 'Sale',
            meta: `${sale.customer_name ?? 'Walk-in'} · TZS ${formatMoney(sale.quantity * sale.unit_price)}`,
            href: '/(tabs)/sales' as Href,
          })),
      ].slice(0, 12)
    : [];
  const enoughStock = products.filter((p) => p.quantity > p.reorder_level).length;
  const outOfStock = products.filter((p) => p.quantity <= 0).length;
  const lowButAvailable = lowStock.filter((p) => p.quantity > 0).length;
  const today = startOfDay(new Date());
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const sevenDaysAgo = new Date(today);
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6);
  const todaySaleRows = sales.filter((sale) => new Date(sale.created_at) >= today);
  const yesterdaySaleRows = sales.filter((sale) => {
    const created = new Date(sale.created_at);
    return created >= yesterday && created < today;
  });
  const lastSevenDayRows = sales.filter((sale) => new Date(sale.created_at) >= sevenDaysAgo);
  const todaySales = todaySaleRows.reduce((sum, sale) => sum + sale.quantity * sale.unit_price, 0);
  const yesterdaySales = yesterdaySaleRows.reduce((sum, sale) => sum + sale.quantity * sale.unit_price, 0);
  const sevenDaySales = lastSevenDayRows.reduce((sum, sale) => sum + sale.quantity * sale.unit_price, 0);
  const sevenDayAverage = Math.round(sevenDaySales / 7);
  const dailySalesMap = sales.reduce<Record<string, number>>((map, sale) => {
    const key = new Date(sale.created_at).toISOString().slice(0, 10);
    map[key] = (map[key] ?? 0) + sale.quantity * sale.unit_price;
    return map;
  }, {});
  const bestSalesDay = Object.entries(dailySalesMap).sort(([, a], [, b]) => b - a)[0];
  const salesVsYesterday = yesterdaySales > 0 ? Math.round(((todaySales - yesterdaySales) / yesterdaySales) * 100) : todaySales > 0 ? 100 : 0;
  const salesPace = todaySales >= sevenDayAverage ? 'Juu ya wastani' : 'Chini ya wastani';
  const fastMovers = Object.values(
    lastSevenDayRows.reduce<Record<string, FastMoverRow>>((map, sale) => {
      const productId = sale.product_id ?? sale.products?.id ?? null;
      const key = productId ?? sale.products?.name ?? 'unknown';
      const current = map[key] ?? {
        productId,
        name: sale.products?.name ?? 'Bidhaa',
        quantity: 0,
        revenue: 0,
        unit: sale.products?.unit ?? '',
      };
      current.quantity += sale.quantity;
      current.revenue += sale.quantity * sale.unit_price;
      map[key] = current;
      return map;
    }, {})
  )
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, 4);
  const sevenDaySoldByProduct = lastSevenDayRows.reduce<Record<string, number>>((map, sale) => {
    map[sale.product_id] = (map[sale.product_id] ?? 0) + sale.quantity;
    return map;
  }, {});
  const stockRisks = products
    .map<StockRiskRow | null>((product) => {
      const soldSevenDays = sevenDaySoldByProduct[product.id] ?? 0;
      if (soldSevenDays <= 0) return null;
      const dailyVelocity = soldSevenDays / 7;
      const daysCover = dailyVelocity > 0 ? Math.floor(product.quantity / dailyVelocity) : 999;
      return {
        productId: product.id,
        name: product.name,
        quantity: product.quantity,
        unit: product.unit,
        soldSevenDays,
        daysCover,
      };
    })
    .filter((item): item is StockRiskRow => !!item)
    .filter((item) => item.daysCover <= 14 || item.quantity <= 0)
    .sort((a, b) => a.daysCover - b.daysCover)
    .slice(0, 4);
  const todayCashCollected = todaySaleRows
    .filter((sale) => (sale.payment_method ?? 'cash') === 'cash')
    .reduce((sum, sale) => sum + sale.amount_paid, 0);
  const todayMpesaCollected = todaySaleRows
    .filter((sale) => sale.payment_method === 'mpesa')
    .reduce((sum, sale) => sum + sale.amount_paid, 0);
  const todayBankCollected = todaySaleRows
    .filter((sale) => sale.payment_method === 'bank')
    .reduce((sum, sale) => sum + sale.amount_paid, 0);
  const todayCreditBalance = todaySaleRows
    .filter((sale) => sale.payment_method === 'credit')
    .reduce((sum, sale) => sum + Math.max(sale.quantity * sale.unit_price - sale.amount_paid, 0), 0);
  const todayCollectedTotal = todayCashCollected + todayMpesaCollected + todayBankCollected;
  const todayExpenses = expenses
    .filter((expense) => new Date(expense.created_at) >= today)
    .reduce((sum, expense) => sum + expense.amount, 0);
  const todayCashExpected = todayCashCollected - todayExpenses;
  const operationCashBalance = operationCashSummary?.balance ?? 0;
  const operationCashLow = operationCashBalance < OPERATION_CASH_MINIMUM;
  const cashierTodayExpenseTotal = cashierTodayExpenses.reduce((sum, expense) => sum + expense.amount, 0);
  const todayCost = todaySaleRows.reduce(
    (sum, sale) => sum + sale.quantity * (sale.products?.cost_price ?? 0),
    0
  );
  const mawingaNames = new Set([
    ...mawinga.map((winga) => winga.name.trim().toLowerCase()).filter(Boolean),
    ...debts.map((debt) => debt.customer_name.trim().toLowerCase()).filter(Boolean),
  ]);
  const mawingaBalance = debts.reduce((sum, debt) => sum + Math.max(debt.amount - debt.amount_paid, 0), 0);
  const mawingaCount = mawingaNames.size;
  const dueDebts = debts.filter((debt) => {
    if (Math.max(debt.amount - debt.amount_paid, 0) <= 0) return false;
    if (!debt.due_date) return daysSince(debt.created_at) >= 7;
    return new Date(debt.due_date) <= new Date();
  });
  const dueDebtBalance = dueDebts.reduce((sum, debt) => sum + Math.max(debt.amount - debt.amount_paid, 0), 0);
  const pendingQuotationValue = quotations.reduce((sum, quote) => sum + quote.total_amount, 0);
  const todayProfit = todaySales - todayCost - todayExpenses;
  const recentSales = [...sales]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);
  const firstLowStock = [...lowStock].sort((a, b) => a.quantity - b.quantity)[0];
  const oldestDueDebt = [...dueDebts].sort((a, b) => {
    const aDate = a.due_date ?? a.created_at;
    const bDate = b.due_date ?? b.created_at;
    return new Date(aDate).getTime() - new Date(bDate).getTime();
  })[0];
  const firstPendingQuotation = quotations[0];
  const priorityTasks = [
    firstLowStock
      ? {
          title: 'Ongeza stock pungufu',
          subtitle: `${firstLowStock.name}: ${formatQuantity(firstLowStock.quantity)} ${firstLowStock.unit} zimebaki`,
          action: 'Fungua bidhaa',
          tone: 'warning' as const,
          href: `/(tabs)/products/${firstLowStock.id}` as Href,
        }
      : null,
    isAdmin && oldestDueDebt
      ? {
          title: 'Fuatilia deni lililochelewa',
          subtitle: `${oldestDueDebt.customer_name}: TZS ${formatMoney(Math.max(oldestDueDebt.amount - oldestDueDebt.amount_paid, 0))}`,
          action: 'Fungua ledgers',
          tone: 'danger' as const,
          href: '/(tabs)/finance/ledgers' as Href,
        }
      : null,
    firstPendingQuotation
      ? {
          title: 'Funga quotation/proforma',
          subtitle: `${firstPendingQuotation.customer_name}: TZS ${formatMoney(firstPendingQuotation.total_amount)} (${firstPendingQuotation.status})`,
          action: 'Fungua docs',
          tone: 'warning' as const,
          href: '/(tabs)/finance/quotations' as Href,
        }
      : null,
    isAdmin && (todaySaleRows.length > 0 || todayExpenses > 0)
      ? {
          title: 'Daily closing ya leo',
          subtitle: `Expected cash: TZS ${formatMoney(todayCashExpected)}`,
          action: 'Funga siku',
          tone: todayCashExpected < 0 ? ('danger' as const) : ('success' as const),
          href: '/(tabs)/finance/daily-closing' as Href,
        }
      : null,
  ].filter(Boolean) as { title: string; subtitle: string; action: string; tone: 'success' | 'warning' | 'danger'; href: Href }[];
  const todayChecklist = [
    {
      label: 'Mauzo yameingia',
      done: todaySaleRows.length > 0,
      detail: `${todaySaleRows.length} miamala leo`,
    },
    {
      label: 'Expenses zimekaguliwa',
      done: todayExpenses >= 0,
      detail: `TZS ${formatMoney(todayExpenses)} recorded`,
    },
    {
      label: 'Madeni yamefuatiliwa',
      done: dueDebts.length === 0,
      detail: dueDebts.length > 0 ? `${dueDebts.length} due` : 'Hakuna due debts',
    },
    {
      label: 'Docs zimefanyiwa kazi',
      done: quotations.length === 0,
      detail: quotations.length > 0 ? `${quotations.length} pending` : 'Hakuna pending docs',
    },
    {
      label: 'Daily closing',
      done: !!todayClosing,
      detail: todayClosing ? `Imefungwa TZS ${formatMoney(todayClosing.actual_cash)}` : 'Bado haijafungwa',
    },
  ];
  const checklistDone = todayChecklist.filter((item) => item.done).length;
  const branchAttentionItems = branchWatchRows
    .filter((branch) => branch.lowStock > 0 || branch.dueDebts > 0 || branch.pendingQuotes > 0 || branch.cashExpected < 0)
    .slice(0, 3);
  const documentPipeline = (['draft', 'sent', 'accepted'] as const).map((status) => {
    const statusDocs = quotations.filter((quote) => quote.status === status);
    return {
      status,
      label: status === 'draft' ? 'Draft' : status === 'sent' ? 'Sent' : 'Accepted',
      count: statusDocs.length,
      value: statusDocs.reduce((sum, quote) => sum + quote.total_amount, 0),
    };
  });
  const notificationAlerts = [
    lowStock.length > 0
      ? {
          title: 'Low stock inahitaji action',
          detail: `${lowStock.length} bidhaa zipo chini ya kiwango. ${firstLowStock?.name ?? 'Angalia stock'} ndiyo ya kwanza.`,
          actionLabel: 'Ongeza stock',
          tone: 'warning' as const,
          href: '/(tabs)/movements' as Href,
        }
      : null,
    isAdmin && dueDebts.length > 0
      ? {
          title: 'Mawinga/Madeni yamefika muda',
          detail: `${dueDebts.length} account(s) · TZS ${formatMoney(dueDebtBalance)} zinahitaji follow-up.`,
          actionLabel: 'Tuma WhatsApp',
          tone: 'danger' as const,
          href: '/(tabs)/finance/ledgers' as Href,
        }
      : null,
    operationCashLow
      ? {
          title: 'Operation cash iko chini',
          detail: `Balance ni TZS ${formatMoney(operationCashBalance)} chini ya limit TZS ${formatMoney(OPERATION_CASH_MINIMUM)}.`,
          actionLabel: 'Ongeza operation cash',
          tone: 'danger' as const,
          href: '/(tabs)/finance/operation-cash' as Href,
        }
      : null,
    isAdmin && quotations.length > 0
      ? {
          title: 'Documents pending',
          detail: `${quotations.length} quotation/proforma/invoice · TZS ${formatMoney(pendingQuotationValue)} bado hazijafungwa.`,
          actionLabel: 'Open docs',
          tone: 'warning' as const,
          href: '/(tabs)/finance/quotations' as Href,
        }
      : null,
    isAdmin && pendingStoreLogCount > 0
      ? {
          title: 'Store Log approvals pending',
          detail: `${pendingStoreLogCount} record(s) za mzigo zinasubiri Manager/Owner kuthibitisha.`,
          actionLabel: 'Approve',
          tone: 'warning' as const,
          href: storeLogBookHref,
        }
      : null,
    offlinePendingCount > 0
      ? {
          title: 'Offline sales hazijasync',
          detail: `${offlinePendingCount} mauzo yanasubiri internet. Bonyeza kusync sasa.`,
          actionLabel: 'Sync now',
          tone: 'warning' as const,
          href: '/(tabs)/sales' as Href,
        }
      : null,
  ].filter(Boolean) as { title: string; detail: string; actionLabel: string; tone: 'warning' | 'danger'; href: Href }[];

  const todayExpenseRows = expenses.filter((expense) => new Date(expense.created_at) >= today);
  const rawRecentActivityItems: (RecentActivityItem | null)[] = [
    ...todaySaleRows.slice(0, 3).map((sale) => ({
      key: `sale-${sale.id}`,
      title: `${sale.profiles?.full_name ?? 'Staff'} aliuza TZS ${formatMoney(sale.quantity * sale.unit_price)}`,
      detail: `${sale.products?.name ?? 'Bidhaa'} · ${formatDateTime(sale.created_at)}`,
      amount: `TZS ${formatMoney(sale.quantity * sale.unit_price)}`,
      tone: 'success' as const,
      createdAt: sale.created_at,
      href: '/(tabs)/sales' as Href,
    })),
    ...todayExpenseRows.slice(0, 3).map((expense) => ({
      key: `expense-${expense.id}`,
      title: `${expense.profiles?.full_name ?? 'Staff'} ameongeza expense`,
      detail: `${expense.title} · TZS ${formatMoney(expense.amount)} · ${formatDateTime(expense.created_at)}`,
      amount: `TZS ${formatMoney(expense.amount)}`,
      tone: 'danger' as const,
      createdAt: expense.created_at,
      href: '/(tabs)/finance' as Href,
    })),
    pendingStoreLogCount > 0
      ? {
          key: 'store-log-pending',
          title: `Store log pending ${pendingStoreLogCount}`,
          detail: 'Mzigo unasubiri Manager/Owner kuthibitisha',
          amount: 'Approve',
          tone: 'warning' as const,
          createdAt: new Date().toISOString(),
          href: storeLogBookHref,
        }
      : null,
    ...auditLogs.slice(0, 2).map((log) => ({
      key: `audit-${log.id}`,
      title: log.profiles?.full_name ?? 'System',
      detail: `${auditActionLabel(log)} · ${formatDateTime(log.created_at)}`,
      tone: 'default' as const,
      createdAt: log.created_at,
      href: '/(tabs)/profile/audit-log' as Href,
    })),
  ];
  const recentActivityItems = rawRecentActivityItems
    .filter((item): item is RecentActivityItem => !!item)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5);
  const aiInsights = [
    todaySales <= 0
      ? {
          title: 'AI: mauzo bado hayajaanza leo',
          detail: 'Fungua sales pulse na fast movers kuona bidhaa za kusukuma leo.',
          tone: 'warning' as const,
          href: '/(tabs)/sales/new' as Href,
        }
      : {
          title: salesVsYesterday >= 0 ? 'AI: mauzo yako juu ya jana' : 'AI: mauzo yameshuka ukilinganisha na jana',
          detail:
            yesterdaySales > 0
              ? `${Math.abs(salesVsYesterday)}% ${salesVsYesterday >= 0 ? 'juu' : 'chini'} ya jana. Angalia product zinazotembea zaidi.`
              : 'Endelea kufuatilia payment mix na fast movers.',
          tone: salesVsYesterday >= 0 ? ('success' as const) : ('warning' as const),
          href: '/(tabs)/reports' as Href,
        },
    operationCashLow
      ? {
          title: 'AI: operation cash iko chini',
          detail: `Balance ni TZS ${formatMoney(operationCashBalance)}. Ongeza float kabla expenses hazijazuia operations.`,
          tone: 'danger' as const,
          href: '/(tabs)/finance/operation-cash' as Href,
        }
      : null,
    lowStock.length > 0
      ? {
          title: 'AI: stock risk ipo',
          detail: `${lowStock.length} bidhaa zipo chini. ${firstLowStock?.name ?? 'Bidhaa ya kwanza'} ipewe kipaumbele.`,
          tone: 'warning' as const,
          href: '/(tabs)/movements' as Href,
        }
      : null,
    dueDebts.length > 0
      ? {
          title: 'AI: Mawinga/Madeni yafuatiliwe',
          detail: `${dueDebts.length} account(s), TZS ${formatMoney(dueDebtBalance)} zinahitaji reminder leo.`,
          tone: 'danger' as const,
          href: '/(tabs)/finance/ledgers' as Href,
        }
      : null,
  ]
    .filter((item): item is AiInsight => !!item)
    .slice(0, 4);
  const aiReorderSuggestions = lowStock
    .map<AiReorderSuggestion>((product) => {
      const soldSevenDays = sevenDaySoldByProduct[product.id] ?? 0;
      const targetStock = Math.max(product.reorder_level * 2, product.quantity + soldSevenDays, product.reorder_level + 1, 1);
      const suggestedQty = Math.max(1, Math.ceil(targetStock - product.quantity));
      return {
        productId: product.id,
        name: product.name,
        quantity: suggestedQty,
        unit: product.unit,
        reason:
          soldSevenDays > 0
            ? `Sold ${formatQuantity(soldSevenDays)} siku 7, stock ${formatQuantity(product.quantity)}`
            : `Stock ${formatQuantity(product.quantity)} iko chini ya reorder ${formatQuantity(product.reorder_level)}`,
      };
    })
    .sort((a, b) => b.quantity - a.quantity)
    .slice(0, 3);
  const aiAskExamples: AiAskExample[] = [
    {
      label: 'Muhtasari wa leo',
      question: 'Niambie muhtasari wa leo',
      icon: HomeIcons.trend,
      fallback: '↗',
    },
    {
      label: 'Nani ana deni kubwa?',
      question: 'Nani ana deni kubwa?',
      icon: HomeIcons.person,
      fallback: '♙',
    },
    {
      label: 'Mauzo wiki hii',
      question: 'Mauzo wiki hii yakoje?',
      icon: HomeIcons.orders,
      fallback: '▱',
    },
  ];
  const branchNameById = (branchId?: string | null) =>
    branches.find((branch) => branch.id === branchId)?.name ?? (branchId ? 'Branch isiyojulikana' : 'No branch');
  const branchSalesSevenDays = Object.values(
    lastSevenDayRows.reduce<Record<string, { branchId: string | null; name: string; revenue: number; transactions: number }>>(
      (map, sale) => {
        const key = sale.branch_id ?? 'no-branch';
        const current = map[key] ?? {
          branchId: sale.branch_id ?? null,
          name: branchNameById(sale.branch_id),
          revenue: 0,
          transactions: 0,
        };
        current.revenue += sale.quantity * sale.unit_price;
        current.transactions += 1;
        map[key] = current;
        return map;
      },
      {}
    )
  ).sort((a, b) => b.revenue - a.revenue);
  const topDebtCustomers = Object.values(
    debts.reduce<Record<string, { name: string; balance: number; count: number; oldestDays: number }>>((map, debt) => {
      const balance = Math.max(debt.amount - debt.amount_paid, 0);
      if (balance <= 0) return map;
      const key = debt.customer_name.trim().toLowerCase();
      const current = map[key] ?? { name: debt.customer_name, balance: 0, count: 0, oldestDays: 0 };
      current.balance += balance;
      current.count += 1;
      current.oldestDays = Math.max(current.oldestDays, daysSince(debt.created_at));
      map[key] = current;
      return map;
    }, {})
  ).sort((a, b) => b.balance - a.balance);
  const expenseCategoryRows = Object.values(
    expenses.reduce<Record<string, { category: string; amount: number; count: number }>>((map, expense) => {
      const category = expense.category || 'Other';
      const current = map[category] ?? { category, amount: 0, count: 0 };
      current.amount += expense.amount;
      current.count += 1;
      map[category] = current;
      return map;
    }, {})
  ).sort((a, b) => b.amount - a.amount);
  const submitAiQuestion = (question = aiQuestion) => {
    const nextQuestion = question.trim();
    if (!nextQuestion) return;
    setAiQuestion(nextQuestion);
    setAiSubmittedQuestion(nextQuestion);
  };
  const aiAskAnswer = (() => {
    const question = aiSubmittedQuestion.trim();
    const q = question.toLowerCase();
    if (!q) {
      return '';
    }

    if (q.includes('muhtasari') || q.includes('summary')) {
      return `Leo: mauzo TZS ${formatMoney(todaySales)}, orders ${todaySaleRows.length}, matumizi TZS ${formatMoney(todayExpenses)}, operation cash TZS ${formatMoney(operationCashBalance)}. Low stock ${lowStock.length}.`;
    }

    if (
      (q.includes('branch') || q.includes('mauzo') || q.includes('uza')) &&
      (q.includes('uza') || q.includes('mauzo') || q.includes('wiki') || q.includes('zaidi'))
    ) {
      const topBranch = branchSalesSevenDays[0];
      if (!topBranch || topBranch.revenue <= 0) {
        return 'Bado hakuna mauzo ya wiki hii kwenye branch scope uliyochagua.';
      }
      const secondBranch = branchSalesSevenDays[1];
      const scopeNote =
        dashboardBranchId && branchSalesSevenDays.length <= 1
          ? ' Upo kwenye branch moja; chagua All branches juu ukitaka comparison ya branches zote.'
          : '';
      return `${topBranch.name} ndiyo imeuza zaidi wiki hii: TZS ${formatMoney(topBranch.revenue)} (${topBranch.transactions} miamala).${
        secondBranch ? ` Inafuata ${secondBranch.name}: TZS ${formatMoney(secondBranch.revenue)}.` : ''
      }${scopeNote}`;
    }

    if (q.includes('deni') || q.includes('mawinga') || q.includes('customer')) {
      const topDebt = topDebtCustomers[0];
      if (!topDebt) {
        return 'Kwa sasa hakuna deni wazi kwenye scope hii.';
      }
      return `${topDebt.name} ana deni kubwa zaidi: TZS ${formatMoney(topDebt.balance)} (${topDebt.count} record). Deni la zamani zaidi lina siku ${topDebt.oldestDays}.`;
    }

    if (q.includes('stock') || q.includes('bidhaa') || q.includes('isha') || q.includes('agiza')) {
      if (lowStock.length === 0) {
        return 'Stock iko sawa kwa sasa; hakuna bidhaa iliyo chini ya reorder level.';
      }
      const productsToWatch = [...lowStock]
        .sort((a, b) => a.quantity - b.quantity)
        .slice(0, 3)
        .map((product) => `${product.name} (${formatQuantity(product.quantity)} ${product.unit})`)
        .join(', ');
      return `Bidhaa za kuangalia kwanza: ${productsToWatch}. Fungua Stock ili kuongeza au kufanya transfer.`;
    }

    if (q.includes('matumizi') || q.includes('expense') || q.includes('gharama')) {
      const topCategory = expenseCategoryRows[0];
      if (!topCategory) {
        return 'Bado hakuna matumizi kwenye siku 30 zilizopo kwenye dashboard hii.';
      }
      return `Category inayotumia zaidi ni ${topCategory.category}: TZS ${formatMoney(topCategory.amount)} (${topCategory.count} record). Jumla ya leo ni TZS ${formatMoney(todayExpenses)}.`;
    }

    if (q.includes('faida') || q.includes('profit')) {
      return `Faida ya leo kwa scope hii ni TZS ${formatMoney(todayProfit)}. Mauzo TZS ${formatMoney(todaySales)}, cost TZS ${formatMoney(todayCost)}, matumizi TZS ${formatMoney(todayExpenses)}.`;
    }

    if (q.includes('cash') || q.includes('operation')) {
      return `Operation cash balance ni TZS ${formatMoney(operationCashBalance)}. ${
        operationCashLow ? 'Iko chini ya limit, ongeza operation cash.' : 'Iko juu ya limit ya sasa.'
      }`;
    }

    return 'Naweza kujibu maswali ya mauzo ya branch, deni kubwa, low stock, matumizi, faida, na operation cash. Jaribu kuuliza kwa maneno hayo.';
  })();

  if (loading) {
    return (
      <Screen>
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      </Screen>
    );
  }

  if (!isAdmin) {
    return (
      <Screen showBranchBar={false}>
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
          <View style={styles.topHeader}>
            <View style={styles.brandRow}>
              <Pressable style={styles.menuButton} onPress={() => setMenuOpen(true)}>
                <AppIcon
                  name={HomeIcons.menu}
                  fallback="☰"
                  size={26}
                  color={Colors.primaryDark}
                  fallbackStyle={styles.menuButtonText}
                />
              </Pressable>
              <View style={styles.brandTextBlock}>
                <Text style={styles.greeting}>Habari{profile?.full_name ? `, ${profile.full_name}` : ''}</Text>
                <Pressable onPress={() => setBranchOpen(true)}>
                  <Text style={styles.storeName}>{dashboardBranchName}⌄</Text>
                </Pressable>
              </View>
            </View>
            <Pressable style={styles.headerIcon} onPress={() => router.push('/(tabs)/profile' as Href)}>
              <AppIcon
                name={HomeIcons.settings}
                fallback="⚙"
                size={25}
                color={Colors.primary}
                fallbackStyle={styles.headerIconText}
              />
            </Pressable>
          </View>

          <HamburgerMenu
            visible={menuOpen}
            onClose={() => setMenuOpen(false)}
            profileName={profile?.full_name ?? 'Mtumiaji'}
            isAdmin={isAdmin}
            isOwner={isOwner}
            storeLogBookHref={storeLogBookHref}
            onLogout={signOut}
          />

          <BranchPicker
            visible={branchOpen}
            branches={branches}
            selectedBranchId={dashboardBranchId}
            showAllOption={isOwner}
            onSelect={(branchId) => {
              if (branchId === null) {
                setShowAllBranches(true);
              } else {
                setShowAllBranches(false);
                setSelectedBranchId(branchId);
              }
              setBranchOpen(false);
            }}
            onClose={() => setBranchOpen(false)}
          />

          <View style={styles.cashierPanel}>
            <Text style={styles.sectionTitle}>Cashier Mode</Text>
            <Text style={styles.commandSubtitle}>Kazi za msingi za branch hii</Text>
            <View style={styles.cashierActionGrid}>
              <QuickAction label="Uza" icon={HomeIcons.cart} fallback="⌑" href="/(tabs)/sales/new" tone="dark" />
              <QuickAction label="Matumizi" icon={HomeIcons.wallet} fallback="▤" href="/(tabs)/finance/new-expense" tone="blue" />
              <QuickAction label="Log Book" icon={HomeIcons.logBook} fallback="▥" href={storeLogBookHref} tone="teal" />
              <QuickAction
                label="Mawinga"
                icon={HomeIcons.people}
                fallback="♙"
                href={'/(tabs)/finance/ledgers' as Href}
                tone="green"
                badge={mawingaCount}
              />
            </View>
            <Pressable
              style={({ pressed }) => [styles.cashierBalanceCard, operationCashLow && styles.cashierBalanceDanger, pressed && styles.pressed]}
              onPress={() => router.push('/(tabs)/finance' as Href)}>
              <Text style={styles.cashierBalanceLabel}>Operation Cash Balance</Text>
              <Text style={[styles.cashierBalanceValue, operationCashLow && styles.dangerText]}>
                TZS {formatMoney(operationCashBalance)}
              </Text>
              <Text style={styles.cashierBalanceMeta}>
                {operationCashLow ? 'Operation cash iko chini' : 'Cash ya matumizi iko sawa'}
              </Text>
            </Pressable>
            <View style={styles.cashierExpensePanel}>
              <View style={styles.cashierExpenseHeader}>
                <View>
                  <Text style={styles.cashierExpenseTitle}>Matumizi ya Leo</Text>
                  <Text style={styles.cashierExpenseMeta}>
                    {cashierTodayExpenses.length} record(s) · TZS {formatMoney(cashierTodayExpenseTotal)}
                  </Text>
                </View>
                <Pressable onPress={() => router.push('/(tabs)/finance/new-expense' as Href)}>
                  <Text style={styles.cashierExpenseAction}>+ Ongeza</Text>
                </Pressable>
              </View>
              {cashierTodayExpenses.length === 0 ? (
                <Text style={styles.cashierExpenseEmpty}>Hakuna matumizi yaliyoandikwa leo.</Text>
              ) : (
                cashierTodayExpenses.slice(0, 6).map((expense) => (
                  <View key={expense.id} style={styles.cashierExpenseRow}>
                    <View style={styles.cashierExpenseInfo}>
                      <Text style={styles.cashierExpenseName}>{expense.title}</Text>
                      <Text style={styles.cashierExpenseDetail}>
                        {expense.category ?? 'Matumizi'} · {formatDateTime(expense.created_at)}
                      </Text>
                    </View>
                    <View style={styles.cashierExpenseRight}>
                      <Text style={styles.cashierExpenseAmount}>TZS {formatMoney(expense.amount)}</Text>
                      <Text style={[styles.cashierReceiptBadge, !expense.has_receipt && styles.cashierReceiptMissing]}>
                        {expense.has_receipt ? 'Attached' : 'No receipt'}
                      </Text>
                    </View>
                  </View>
                ))
              )}
            </View>
          </View>
        </ScrollView>
      </Screen>
    );
  }

  return (
    <Screen showBranchBar={false}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}>
        <View style={styles.ownerHero}>
          <View style={[styles.topHeader, styles.heroHeader]}>
            <View pointerEvents="none" style={styles.heroHeaderArtwork}>
              <View style={styles.heroHeaderGlowOne} />
              <View style={styles.heroHeaderGlowTwo} />
              <View style={styles.heroHeaderRingOne} />
              <View style={styles.heroHeaderRingTwo} />
              <View style={[styles.heroHeaderStripe, styles.heroHeaderStripeOne]} />
              <View style={[styles.heroHeaderStripe, styles.heroHeaderStripeTwo]} />
              <View style={[styles.heroHeaderStripe, styles.heroHeaderStripeThree]} />
              <View style={[styles.heroHeaderDot, styles.heroHeaderDotOne]} />
              <View style={[styles.heroHeaderDot, styles.heroHeaderDotTwo]} />
              <View style={[styles.heroHeaderDot, styles.heroHeaderDotThree]} />
            </View>
            <View style={styles.brandRow}>
              <Pressable style={[styles.menuButton, styles.heroMenuButton]} onPress={() => setMenuOpen(true)}>
                <AppIcon
                  name={HomeIcons.menu}
                  fallback="☰"
                  size={26}
                  color={Colors.white}
                  fallbackStyle={[styles.menuButtonText, styles.heroMenuButtonText]}
                />
              </Pressable>
              <View style={styles.brandTextBlock}>
                <Text style={[styles.greeting, styles.heroGreeting]}>
                  Habari{profile?.full_name ? `, ${profile.full_name.split(' ')[0]}` : ''}
                </Text>
                <Text style={styles.heroWelcome}>Karibu kwenye paneli yako ya uendeshaji</Text>
              </View>
            </View>
            <View style={styles.headerActions}>
              <Pressable style={styles.heroBell} onPress={() => router.push('/(tabs)/finance' as Href)}>
                <AppIcon name={HomeIcons.bell} fallback="!" size={25} color={Colors.white} fallbackStyle={styles.heroBellText} />
                {notificationAlerts.length > 0 ? <Text style={styles.heroBellBadge}>{notificationAlerts.length}</Text> : null}
              </Pressable>
            </View>
          </View>

          <Pressable
            style={({ pressed }) => [styles.branchHeroPanel, pressed && styles.pressed]}
            onPress={() => setBranchOpen(true)}>
            <View style={styles.branchHeroTop}>
              <View style={styles.branchHeroIdentity}>
                <View style={styles.branchIconBox}>
                  <AppIcon
                    name={HomeIcons.store}
                    fallback="▣"
                    size={25}
                    color={Colors.white}
                    fallbackStyle={styles.branchIconText}
                  />
                </View>
                <View style={styles.branchHeroText}>
                  <Text style={styles.branchHeroName}>{dashboardBranchName} ▾</Text>
                </View>
              </View>
              {isOwner ? (
                <View style={styles.branchHeroMode}>
                  <AppIcon
                    name={HomeIcons.globe}
                    fallback="◎"
                    size={16}
                    color={Colors.primaryDark}
                    fallbackStyle={styles.branchHeroModeIconFallback}
                  />
                  <Text style={styles.branchHeroModeText}>All Branches</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.branchHeroDivider} />
            <View style={styles.branchHeroBottom}>
              <Text style={styles.branchHeroMeta}>
                Branch ID: {dashboardBranchName.toUpperCase().slice(0, 4)}-001 · Dar es Salaam
              </Text>
              <Text style={styles.branchOnline}>● Online</Text>
            </View>
          </Pressable>
        </View>

        <HamburgerMenu
          visible={menuOpen}
          onClose={() => setMenuOpen(false)}
          profileName={profile?.full_name ?? 'Mtumiaji'}
          isAdmin={isAdmin}
          isOwner={isOwner}
          storeLogBookHref={storeLogBookHref}
          onLogout={signOut}
        />

        <BranchPicker
          visible={branchOpen}
          branches={branches}
          selectedBranchId={dashboardBranchId}
          showAllOption={isOwner}
          onSelect={(branchId) => {
            if (branchId === null) {
              setShowAllBranches(true);
            } else {
              setShowAllBranches(false);
              setSelectedBranchId(branchId);
            }
            setBranchOpen(false);
          }}
          onClose={() => setBranchOpen(false)}
        />

        <GlobalSearchModal
          visible={searchOpen}
          query={globalSearch}
          results={globalResults}
          onChangeQuery={setGlobalSearch}
          onClose={() => setSearchOpen(false)}
          onOpenResult={(href) => {
            setSearchOpen(false);
            setGlobalSearch('');
            router.push(href);
          }}
        />

        <Pressable style={styles.searchBar} onPress={() => setSearchOpen(true)}>
          <AppIcon
            name={HomeIcons.search}
            fallback="⌕"
            size={25}
            color="#66758B"
            style={styles.searchIconWrap}
            fallbackStyle={styles.searchIcon}
          />
          <Text style={styles.searchText}>Tafuta bidhaa, mteja, document, au ripoti...</Text>
          <View style={styles.filterButton}>
            <AppIcon
              name={HomeIcons.filter}
              fallback="☷"
              size={24}
              color={Colors.primaryDark}
              fallbackStyle={styles.filterButtonText}
            />
          </View>
        </Pressable>

        {isAdmin && !setupCompleted ? (
          <Pressable
            style={({ pressed }) => [styles.setupPrompt, pressed && styles.pressed]}
            onPress={() => router.push('/(tabs)/profile/setup-wizard' as Href)}>
            <View>
              <Text style={styles.setupPromptTitle}>Malizia Setup Wizard</Text>
              <Text style={styles.setupPromptText}>
                Weka kampuni, branches, categories, users na receipt kabla ya kuanza kutumia data halisi.
              </Text>
            </View>
            <Text style={styles.setupPromptAction}>Start</Text>
          </Pressable>
        ) : null}

        <View style={styles.quickPanel}>
          <Text style={styles.sectionTitle}>Vitendo vya Haraka</Text>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.quickGrid}>
            <QuickAction label="Uza" icon={HomeIcons.cart} fallback="⌑" href="/(tabs)/sales/new" tone="dark" />
            <QuickAction
              label="Stock"
              icon={HomeIcons.stock}
              fallback="□"
              href={'/(tabs)/movements' as Href}
              tone="green"
              badge={lowStock.length}
            />
            <QuickAction
              label="Mawinga"
              icon={HomeIcons.people}
              fallback="♙"
              href={'/(tabs)/finance/ledgers' as Href}
              tone="green"
              badge={mawingaCount}
            />
            <QuickAction label="Matumizi" icon={HomeIcons.wallet} fallback="▤" href="/(tabs)/finance/new-expense" tone="blue" />
            {isAdmin ? (
              <>
                <QuickAction
                  label="Ongeza Cash"
                  icon={HomeIcons.cashPlus}
                  fallback="+"
                  href={'/(tabs)/finance/operation-cash' as Href}
                  tone="teal"
                />
                <QuickAction
                  label="Documents"
                  icon={HomeIcons.documents}
                  fallback="▧"
                  href={'/(tabs)/finance/quotations' as Href}
                  tone="teal"
                  badge={quotations.length}
                />
              </>
            ) : null}
          </ScrollView>
        </View>

        <AiBusinessAssistant
          insights={aiInsights}
          reorderSuggestions={aiReorderSuggestions}
          showAsk={isAdmin}
          askQuestion={aiQuestion}
          askAnswer={aiAskAnswer}
          askExamples={aiAskExamples}
          onAskQuestionChange={setAiQuestion}
          onAskSubmit={() => submitAiQuestion()}
          onAskExample={(question) => submitAiQuestion(question)}
          onOpenInsight={(href) => router.push(href)}
          onOpenProduct={(productId) => router.push(`/(tabs)/products/${productId}`)}
          onOpenStock={() => router.push('/(tabs)/movements' as Href)}
        />

        {notificationAlerts.length > 0 ? (
          <View style={styles.notificationPanel}>
            <View style={[styles.panelHeader, styles.notificationPanelHeader]}>
              <View>
                <Text style={styles.sectionTitle}>Alerts Muhimu</Text>
                <Text style={styles.commandSubtitle}>Mambo yanayotakiwa kushughulikiwa sasa</Text>
              </View>
              <Text style={styles.updatedText}>{notificationAlerts.length}</Text>
            </View>
            {notificationAlerts.map((alert) => (
              <NotificationAlertRow
                key={alert.title}
                title={alert.title}
                detail={alert.detail}
                tone={alert.tone}
                actionLabel={alert.actionLabel}
                onPress={() => {
                  if (alert.title.includes('Offline')) {
                    syncOfflineNow();
                    return;
                  }
                  router.push(alert.href);
                }}
              />
            ))}
          </View>
        ) : (
          <View style={styles.notificationClearPanel}>
            <Text style={styles.clearTitle}>Alerts ziko sawa</Text>
            <Text style={styles.clearText}>
              Hakuna low stock, mawinga/debts due, store log pending, docs pending au cash issue kubwa kwa sasa.
            </Text>
          </View>
        )}

        <View style={styles.activityPanel}>
          <View style={styles.panelHeader}>
            <View style={styles.panelHeaderText}>
              <Text style={styles.sectionTitle}>Leo nini kimetokea</Text>
              <Text style={styles.commandSubtitle}>Activity muhimu ya branch hii</Text>
            </View>
            <Text style={styles.updatedText}>{recentActivityItems.length}</Text>
          </View>
          {recentActivityItems.length === 0 ? (
            <View style={styles.clearState}>
              <Text style={styles.clearTitle}>Bado hakuna activity leo</Text>
              <Text style={styles.clearText}>Mauzo, matumizi, log book na audit zitaonekana hapa.</Text>
            </View>
          ) : (
            recentActivityItems.map((item) => (
              <RecentActivityRow
                key={item.key}
                item={item}
                onPress={() => {
                  if (item.href) router.push(item.href);
                }}
              />
            ))
          )}
        </View>

        {isAdmin && branchAttentionItems.length > 0 ? (
          <View style={styles.branchAttentionPanel}>
            <View style={styles.panelHeader}>
              <Text style={styles.sectionTitle}>Branch Attention</Text>
              <Text style={styles.updatedText}>{branchAttentionItems.length} alert(s)</Text>
            </View>
            {branchAttentionItems.map((branch) => (
              <Pressable
                key={branch.branchId}
                style={({ pressed }) => [styles.branchAttentionRow, pressed && styles.pressed]}
                onPress={() => setSelectedBranchId(branch.branchId)}>
                <View style={styles.branchAttentionInfo}>
                  <Text style={styles.branchAttentionName}>{branch.name}</Text>
                  <Text style={styles.branchAttentionMeta}>
                    {[
                      branch.lowStock > 0 ? `${branch.lowStock} low stock` : null,
                      branch.dueDebts > 0 ? `${branch.dueDebts} debts due` : null,
                      branch.pendingQuotes > 0 ? `${branch.pendingQuotes} docs pending` : null,
                      branch.cashExpected < 0 ? 'cash negative' : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </Text>
                </View>
                <Text style={styles.branchAttentionAction}>
                  {branch.branchId === dashboardBranchId ? 'Selected' : 'Switch'}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}

        <View style={styles.heroRow}>
          <View style={styles.primarySalesCard}>
            <Text style={styles.primaryCardLabel}>Mauzo leo</Text>
            <Text style={styles.primaryCardValue}>TZS {formatMoney(todaySales)}</Text>
            <Text style={styles.primaryCardTrend}>↗ {salesVsYesterday >= 0 ? '+' : ''}{salesVsYesterday}%</Text>
            <Text style={styles.primaryCardMeta}>Mauzo {todaySaleRows.length} · Bidhaa {formatQuantity(todaySaleRows.reduce((sum, sale) => sum + sale.quantity, 0))}</Text>
            <View style={styles.metricSparkline}>
              <View style={[styles.sparkBar, { height: 14 }]} />
              <View style={[styles.sparkBar, { height: 23 }]} />
              <View style={[styles.sparkBar, { height: 18 }]} />
              <View style={[styles.sparkBar, { height: 34 }]} />
              <View style={[styles.sparkBar, { height: 42 }]} />
            </View>
          </View>

          {isOwner ? (
            <View style={styles.primarySalesCard}>
              <Text style={styles.primaryCardLabel}>Faida leo (GP)</Text>
              <Text style={styles.primaryCardValue}>TZS {formatMoney(todayProfit)}</Text>
              <Text style={styles.primaryCardTrend}>↗ {todaySales > 0 ? Math.round((todayProfit / todaySales) * 100) : 0}%</Text>
              <Text style={styles.primaryCardMeta}>Margin {todaySales > 0 ? Math.round((todayProfit / todaySales) * 100) : 0}%</Text>
              <View style={styles.metricSparkline}>
                <View style={[styles.sparkBar, { height: 16 }]} />
                <View style={[styles.sparkBar, { height: 21 }]} />
                <View style={[styles.sparkBar, { height: 28 }]} />
                <View style={[styles.sparkBar, { height: 38 }]} />
                <View style={[styles.sparkBar, { height: 45 }]} />
              </View>
            </View>
          ) : null}

          <View style={styles.ordersCard}>
            <Text style={styles.primaryCardLabel}>Orders</Text>
            <Text style={styles.ordersValue}>{todaySaleRows.length}</Text>
            <Text style={styles.primaryCardMeta}>Jumla ya orders leo</Text>
            <View style={styles.ordersIcon}>
              <AppIcon
                name={HomeIcons.orders}
                fallback="▱"
                size={25}
                color={Colors.primary}
                fallbackStyle={styles.ordersIconText}
              />
            </View>
          </View>
        </View>

        <View style={styles.commandPanel}>
          <View style={styles.panelHeader}>
            <View>
              <Text style={styles.sectionTitle}>Command Center</Text>
              <Text style={styles.commandSubtitle}>Mambo muhimu ya kushughulikia leo</Text>
            </View>
            <Pressable style={styles.viewMoreButton} onPress={() => toggleSection('commandCenter')}>
              <Text style={styles.viewMoreText}>{expandedSections.commandCenter ? 'View less' : 'View more'}</Text>
            </Pressable>
          </View>
          {expandedSections.commandCenter ? (
            <View style={styles.commandGrid}>
              <CommandAlert
                icon="!"
                title="Low Stock"
                value={String(lowStock.length)}
                subtitle={lowStock.length > 0 ? `${outOfStock} zimeisha, ${lowButAvailable} zipo kidogo` : 'Stock iko sawa'}
                tone={lowStock.length > 0 ? 'warning' : 'success'}
                onPress={() => router.push('/(tabs)/movements' as Href)}
              />
              <CommandAlert
                icon="₮"
                title="Debts Due"
                value={isAdmin ? `TZS ${formatMoney(dueDebtBalance)}` : 'Imefichwa'}
                subtitle={isAdmin ? `${dueDebts.length} deni zinahitaji follow-up` : 'Owner/Manager pekee'}
                tone={dueDebts.length > 0 ? 'danger' : 'success'}
                onPress={() => router.push('/(tabs)/finance/ledgers' as Href)}
              />
              <CommandAlert
                icon="♙"
                title="Mawinga"
                value={String(mawingaCount)}
                subtitle={`Balance ya mzigo: TZS ${formatMoney(mawingaBalance)}`}
                tone={mawingaBalance > 0 ? 'warning' : 'success'}
                onPress={() => router.push('/(tabs)/finance/ledgers' as Href)}
              />
              <CommandAlert
                icon="$"
                title="Cash Expected Leo"
                value={isAdmin ? `TZS ${formatMoney(todayCashExpected)}` : 'Imefichwa'}
                subtitle={isAdmin ? `Cash ${formatMoney(todayCashCollected)} - expenses ${formatMoney(todayExpenses)}` : 'Profit/cash imefichwa'}
                tone={todayCashExpected < 0 ? 'danger' : 'success'}
                onPress={() => router.push('/(tabs)/finance/daily-closing' as Href)}
              />
              <CommandAlert
                icon="₮"
                title="Operation Cash"
                value={`TZS ${formatMoney(operationCashBalance)}`}
                subtitle={operationCashLow ? 'Operation cash iko chini' : 'Balance ya matumizi iko sawa'}
                tone={operationCashLow ? 'danger' : 'success'}
                onPress={() => router.push('/(tabs)/finance' as Href)}
              />
              <CommandAlert
                icon="▤"
                title="Pending Quotations"
                value={String(quotations.length)}
                subtitle={`TZS ${formatMoney(pendingQuotationValue)} bado haijafungwa`}
                tone={quotations.length > 0 ? 'warning' : 'success'}
                onPress={() => router.push('/(tabs)/finance/quotations' as Href)}
              />
              <CommandAlert
                icon="↻"
                title="Offline Sync"
                value={syncingOffline ? 'Syncing...' : String(offlinePendingCount)}
                subtitle={offlinePendingCount > 0 ? 'Mauzo yanasubiri internet' : 'Hakuna pending offline sales'}
                tone={offlinePendingCount > 0 ? 'warning' : 'success'}
                onPress={syncOfflineNow}
              />
            </View>
          ) : (
            <Text style={styles.collapsedSummary}>
              Low stock {lowStock.length} · Operation cash TZS {formatMoney(operationCashBalance)} · Docs {quotations.length}
            </Text>
          )}
        </View>

        <View style={styles.documentPipelinePanel}>
          <View style={styles.panelHeader}>
            <View>
              <Text style={styles.sectionTitle}>Document Pipeline</Text>
              <Text style={styles.commandSubtitle}>Quotation, proforma na invoice ambazo hazijafungwa</Text>
            </View>
            <Pressable style={styles.viewMoreButton} onPress={() => toggleSection('documentPipeline')}>
              <Text style={styles.viewMoreText}>{expandedSections.documentPipeline ? 'View less' : 'View more'}</Text>
            </Pressable>
          </View>
          {expandedSections.documentPipeline ? (
            <>
              <View style={styles.pipelineGrid}>
                {documentPipeline.map((stage) => (
                  <DocumentPipelineStage
                    key={stage.status}
                    label={stage.label}
                    count={stage.count}
                    value={stage.value}
                    active={stage.count > 0}
                  />
                ))}
              </View>
              <Pressable style={styles.panelInlineAction} onPress={() => router.push('/(tabs)/finance/quotations' as Href)}>
                <Text style={styles.panelInlineActionText}>Open documents</Text>
              </Pressable>
            </>
          ) : (
            <Text style={styles.collapsedSummary}>
              {quotations.length} docs pending · TZS {formatMoney(pendingQuotationValue)}
            </Text>
          )}
        </View>

        <View style={styles.priorityPanel}>
          <View style={styles.panelHeader}>
            <Text style={styles.sectionTitle}>Priority Tasks</Text>
            <Text style={styles.updatedText}>{priorityTasks.length} action(s)</Text>
          </View>
          {priorityTasks.length === 0 ? (
            <View style={styles.clearState}>
              <Text style={styles.clearTitle}>Hakuna kazi ya haraka</Text>
              <Text style={styles.clearText}>Stock, madeni, cash na quotations zinaonekana ziko sawa kwa sasa.</Text>
            </View>
          ) : (
            priorityTasks.slice(0, 4).map((task) => (
              <PriorityTask
                key={task.title}
                title={task.title}
                subtitle={task.subtitle}
                action={task.action}
                tone={task.tone}
                onPress={() => router.push(task.href)}
              />
            ))
          )}
        </View>

        <View style={styles.checklistPanel}>
          <View style={styles.panelHeader}>
            <View>
              <Text style={styles.sectionTitle}>Today Checklist</Text>
              <Text style={styles.commandSubtitle}>Thibitisha kabla ya kufunga siku</Text>
            </View>
            <Text style={styles.updatedText}>
              {checklistDone}/{todayChecklist.length}
            </Text>
          </View>
          {todayChecklist.map((item) => (
            <ChecklistRow key={item.label} label={item.label} detail={item.detail} done={item.done} />
          ))}
          {!todayClosing && isAdmin ? (
            <Pressable
              style={({ pressed }) => [styles.checklistAction, pressed && styles.pressed]}
              onPress={() => router.push('/(tabs)/finance/daily-closing' as Href)}>
              <Text style={styles.checklistActionText}>Fungua Daily Closing</Text>
            </Pressable>
          ) : null}
        </View>

        {isAdmin && branchWatchRows.length > 1 ? (
          <View style={styles.branchWatchPanel}>
            <View style={styles.panelHeader}>
              <View>
                <Text style={styles.sectionTitle}>Branch Watchlist</Text>
                <Text style={styles.commandSubtitle}>Linganisho la haraka la branches leo</Text>
              </View>
              <Text style={styles.updatedText}>{branchWatchRows.length} branches</Text>
            </View>
            {branchWatchRows.map((branch) => (
              <BranchWatchCard
                key={branch.branchId}
                branch={branch}
                active={branch.branchId === dashboardBranchId}
                onPress={() => {
                  setShowAllBranches(false);
                  setSelectedBranchId(branch.branchId);
                }}
              />
            ))}
          </View>
        ) : null}

        {isAdmin ? (
          <View style={styles.auditPanel}>
            <View style={styles.panelHeader}>
              <View>
                <Text style={styles.sectionTitle}>Audit Today</Text>
                <Text style={styles.commandSubtitle}>Actions muhimu zilizofanyika leo</Text>
              </View>
              <Pressable onPress={() => router.push('/(tabs)/profile/audit-log' as Href)}>
                <Text style={styles.linkText}>All</Text>
              </Pressable>
            </View>
            {auditLogs.length === 0 ? (
              <View style={styles.clearState}>
                <Text style={styles.clearTitle}>Hakuna audit events leo</Text>
                <Text style={styles.clearText}>Mabadiliko ya stock, price, debt au delete yataonekana hapa.</Text>
              </View>
            ) : (
              auditLogs.slice(0, 4).map((log) => (
                <View key={log.id} style={styles.auditRow}>
                  <Text style={styles.auditTitle}>{auditActionLabel(log)}</Text>
                  <Text style={styles.auditMeta}>
                    {log.profiles?.full_name ?? log.actor_id?.slice(0, 8) ?? 'System'} · {formatDateTime(log.created_at)}
                  </Text>
                </View>
              ))
            )}
          </View>
        ) : null}

        <View style={styles.salesPulsePanel}>
          <View style={styles.panelHeader}>
            <View>
              <Text style={styles.sectionTitle}>Sales Pulse</Text>
              <Text style={styles.commandSubtitle}>Mwenendo wa mauzo kwa branch hii</Text>
            </View>
            <Text style={[styles.updatedText, salesVsYesterday < 0 && styles.dangerText]}>
              {salesVsYesterday >= 0 ? '+' : ''}
              {salesVsYesterday}%
            </Text>
          </View>
          <View style={styles.pulseGrid}>
            <PulseMetric label="Leo" value={`TZS ${formatMoney(todaySales)}`} detail={`${todaySaleRows.length} miamala`} />
            <PulseMetric label="Jana" value={`TZS ${formatMoney(yesterdaySales)}`} detail={`${yesterdaySaleRows.length} miamala`} />
            <PulseMetric label="Avg 7 days" value={`TZS ${formatMoney(sevenDayAverage)}`} detail={salesPace} danger={todaySales < sevenDayAverage} />
            <PulseMetric
              label="Best day"
              value={bestSalesDay ? `TZS ${formatMoney(bestSalesDay[1])}` : 'TZS 0'}
              detail={bestSalesDay ? bestSalesDay[0] : 'Hakuna data'}
            />
          </View>
        </View>

        <View style={styles.paymentMixPanel}>
          <View style={styles.panelHeader}>
            <View>
              <Text style={styles.sectionTitle}>Payment Mix</Text>
              <Text style={styles.commandSubtitle}>Malipo ya leo kwa njia ya malipo</Text>
            </View>
            <Pressable onPress={() => router.push('/(tabs)/finance' as Href)}>
              <Text style={styles.linkText}>Finance</Text>
            </Pressable>
          </View>
          <View style={styles.paymentMixTotalRow}>
            <View>
              <Text style={styles.paymentMixTotalLabel}>Collected today</Text>
              <Text style={styles.paymentMixTotalValue}>TZS {formatMoney(todayCollectedTotal)}</Text>
            </View>
            <Text style={[styles.paymentMixCredit, todayCreditBalance > 0 && styles.warningText]}>
              Credit TZS {formatMoney(todayCreditBalance)}
            </Text>
          </View>
          <View style={styles.paymentMixGrid}>
            <PaymentMixItem label="Cash" amount={todayCashCollected} total={todayCollectedTotal} />
            <PaymentMixItem label="M-Pesa" amount={todayMpesaCollected} total={todayCollectedTotal} />
            <PaymentMixItem label="Bank" amount={todayBankCollected} total={todayCollectedTotal} />
          </View>
        </View>

        <View style={styles.fastMoverPanel}>
          <View style={styles.panelHeader}>
            <View>
              <Text style={styles.sectionTitle}>Fast Movers</Text>
              <Text style={styles.commandSubtitle}>Bidhaa zinazotembea zaidi siku 7</Text>
            </View>
            <Pressable style={styles.viewMoreButton} onPress={() => toggleSection('fastMovers')}>
              <Text style={styles.viewMoreText}>{expandedSections.fastMovers ? 'View less' : 'View more'}</Text>
            </Pressable>
          </View>
          {!expandedSections.fastMovers ? (
            <Text style={styles.collapsedSummary}>
              {fastMovers[0] ? `#1 ${fastMovers[0].name} · TZS ${formatMoney(fastMovers[0].revenue)}` : 'Hakuna fast movers bado'}
            </Text>
          ) : fastMovers.length === 0 ? (
            <View style={styles.clearState}>
              <Text style={styles.clearTitle}>Hakuna fast movers bado</Text>
              <Text style={styles.clearText}>Mauzo ya bidhaa yakiongezeka, utaona top sellers hapa.</Text>
            </View>
          ) : (
            <>
              {fastMovers.map((item, index) => (
                <FastMoverItem
                  key={`${item.productId ?? item.name}-${index}`}
                  item={item}
                  rank={index + 1}
                  onPress={() => (item.productId ? router.push(`/(tabs)/products/${item.productId}`) : router.push('/(tabs)/sales' as Href))}
                />
              ))}
              <Pressable style={styles.panelInlineAction} onPress={() => router.push('/(tabs)/reports' as Href)}>
                <Text style={styles.panelInlineActionText}>Open reports</Text>
              </Pressable>
            </>
          )}
        </View>

        <View style={styles.stockRiskPanel}>
          <View style={styles.panelHeader}>
            <View>
              <Text style={styles.sectionTitle}>Stock Risk</Text>
              <Text style={styles.commandSubtitle}>Bidhaa zinazoweza kuisha mapema</Text>
            </View>
            <Pressable style={styles.viewMoreButton} onPress={() => toggleSection('stockRisk')}>
              <Text style={styles.viewMoreText}>{expandedSections.stockRisk ? 'View less' : 'View more'}</Text>
            </Pressable>
          </View>
          {!expandedSections.stockRisk ? (
            <Text style={styles.collapsedSummary}>
              {stockRisks[0] ? `${stockRisks[0].name} · ${stockRisks[0].daysCover} days cover` : 'Hakuna stock risk kubwa'}
            </Text>
          ) : stockRisks.length === 0 ? (
            <View style={styles.clearState}>
              <Text style={styles.clearTitle}>Hakuna stock risk kubwa</Text>
              <Text style={styles.clearText}>Bidhaa zinazouza kwa sasa zinaonekana zina stock ya kutosha.</Text>
            </View>
          ) : (
            <>
              {stockRisks.map((item) => (
                <StockRiskItem
                  key={item.productId}
                  item={item}
                  onPress={() => router.push(`/(tabs)/products/${item.productId}`)}
                />
              ))}
              <Pressable style={styles.panelInlineAction} onPress={() => router.push('/(tabs)/movements' as Href)}>
                <Text style={styles.panelInlineActionText}>Open stock</Text>
              </Pressable>
            </>
          )}
        </View>

        <View style={styles.summaryPanel}>
          <View style={styles.panelHeader}>
            <Text style={styles.sectionTitle}>Muhtasari wa Leo</Text>
            <Text style={styles.updatedText}>Sasisho: sasa ↻</Text>
          </View>
          <View style={styles.summaryGrid}>
            <SummaryCard
              icon="□"
              title="Hali ya Stock"
              value={formatQuantity(totalUnits)}
              subtitle="Bidhaa zote"
              rows={[
                ['Zipo vya kutosha', String(enoughStock), 'success'],
                ['Zipo kidogo', String(lowButAvailable), 'warning'],
                ['Zimeisha', String(outOfStock), 'danger'],
              ]}
            />
            {isOwner ? (
              <SummaryCard
                icon="$"
                title="Faida ya Leo"
                value={`TZS ${formatMoney(todayProfit)}`}
                footerLabel="Faida %"
                footerValue={todaySales > 0 ? '100%' : '0%'}
              />
            ) : null}
            <SummaryCard
              icon="▰"
              title="Matumizi ya Leo"
              value={isAdmin ? `TZS ${formatMoney(todayExpenses)}` : 'Imefichwa'}
              footerLabel="Miamala"
              footerValue={isAdmin ? String(expenses.length) : '-'}
            />
          </View>
        </View>

        <View style={styles.transactionsPanel}>
          <View style={styles.panelHeader}>
            <Text style={styles.sectionTitle}>Miamala ya Hivi Karibuni</Text>
            <Pressable onPress={() => router.push('/(tabs)/sales' as Href)}>
              <Text style={styles.linkText}>Tazama zote</Text>
            </Pressable>
          </View>
          {recentSales.length === 0 ? (
            <View style={styles.emptyTransaction}>
              <Text style={styles.emptyTitle}>Hakuna miamala bado</Text>
              <Text style={styles.emptyText}>Uza bidhaa au rekodi malipo ili orodha hii ianze kujaa.</Text>
            </View>
          ) : (
            recentSales.map((sale) => (
              <TransactionRow
                key={sale.id}
                title={sale.products?.name ?? 'Mauzo ya Rejareja'}
                subtitle={sale.customer_name ?? `Leo, ${formatDateTime(sale.created_at)}`}
                amount={`TZS ${formatMoney(sale.quantity * sale.unit_price)}`}
                tone="success"
              />
            ))
          )}
        </View>

        <View style={styles.stockHeader}>
          <Text style={styles.sectionTitle}>Tahadhari ya Stock</Text>
          <Pressable onPress={() => router.push('/(tabs)/sales' as Href)}>
            <Text style={styles.warningCount}>{lowStock.length}</Text>
          </Pressable>
        </View>
        {lowStock.length === 0 ? (
          <View style={styles.emptyPanel}>
            <Text style={styles.emptyTitle}>Stock iko sawa</Text>
            <Text style={styles.emptyText}>Hakuna bidhaa zenye stock pungufu kwa sasa.</Text>
          </View>
        ) : (
          lowStock.slice(0, 3).map((product) => (
            <TransactionRow
              key={product.id}
              title={product.name}
              subtitle={`${formatQuantity(product.quantity)} ${product.unit} zimebaki`}
              amount="Stock Pungufu"
              tone="warning"
              onPress={() => router.push(`/(tabs)/products/${product.id}`)}
            />
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

function HamburgerMenu({
  visible,
  onClose,
  profileName,
  isAdmin,
  isOwner,
  storeLogBookHref,
  onLogout,
}: {
  visible: boolean;
  onClose: () => void;
  profileName: string;
  isAdmin: boolean;
  isOwner: boolean;
  storeLogBookHref: Href;
  onLogout: () => Promise<void>;
}) {
  const goTo = (href: Href) => {
    onClose();
    router.push(href);
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.menuOverlay}>
        <Pressable style={styles.menuScrim} onPress={onClose} />
        <View style={styles.menuPanel}>
          <View style={styles.menuHeader}>
            <View style={styles.menuAvatar}>
              <Text style={styles.menuAvatarText}>{profileName.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={styles.menuHeaderText}>
              <Text style={styles.menuTitle}>Duka Langu</Text>
              <Text style={styles.menuSubtitle}>{profileName}</Text>
            </View>
            <Pressable style={styles.menuClose} onPress={onClose}>
              <Text style={styles.menuCloseText}>×</Text>
            </Pressable>
          </View>

          <ScrollView
            style={styles.menuScroll}
            contentContainerStyle={styles.menuItems}
            showsVerticalScrollIndicator={false}>
            <MenuItem icon="⌂" label="Dashboard" onPress={() => goTo('/(tabs)' as Href)} />
            <MenuItem icon="⌑" label="Rekodi Mauzo" onPress={() => goTo('/(tabs)/sales/new' as Href)} />
            <MenuItem icon="▤" label="Mauzo ya Leo" onPress={() => goTo('/(tabs)/sales' as Href)} />
            <MenuItem icon="▥" label="Store Log Book" onPress={() => goTo(storeLogBookHref)} />
            <MenuItem icon="♙" label="Mawinga" onPress={() => goTo('/(tabs)/finance/ledgers' as Href)} />
            {isAdmin ? (
              <>
                {isOwner ? <MenuItem icon="□" label="Bidhaa Mpya" onPress={() => goTo('/(tabs)/products/new' as Href)} /> : null}
                <MenuItem icon="▣" label="Stock In/Out" onPress={() => goTo('/(tabs)/movements' as Href)} />
                {isOwner ? <MenuItem icon="▥" label="Manunuzi" onPress={() => goTo('/(tabs)/movements/purchase' as Href)} /> : null}
                {!isOwner ? (
                  <>
                    <MenuItem icon="▤" label="Rekodi Matumizi" onPress={() => goTo('/(tabs)/finance/new-expense' as Href)} />
                    <MenuItem icon="▱" label="Finance" onPress={() => goTo('/(tabs)/finance' as Href)} />
                    <MenuItem icon="$" label="Daily Closing" onPress={() => goTo('/(tabs)/finance/daily-closing' as Href)} />
                  </>
                ) : null}
                <MenuItem
                  icon="▤"
                  label="Quote / Proforma / Invoice"
                  onPress={() => goTo('/(tabs)/finance/quotations' as Href)}
                />
                {!isOwner ? (
                  <MenuItem icon="⇩" label="Backup / Export" onPress={() => goTo('/(tabs)/finance/export' as Href)} />
                ) : null}
                <MenuItem icon="▥" label="Ripoti" onPress={() => goTo('/(tabs)/reports' as Href)} />
              </>
            ) : null}
            {isOwner ? (
              <>
                <MenuSectionTitle label="Matumizi" />
                <MenuItem icon="▤" label="Rekodi Matumizi" onPress={() => goTo('/(tabs)/finance/new-expense' as Href)} />
                <MenuItem icon="+" label="Operation Cash" onPress={() => goTo('/(tabs)/finance/operation-cash' as Href)} />
                <MenuItem icon="▱" label="Finance / Expense Dashboard" onPress={() => goTo('/(tabs)/finance' as Href)} />
                <MenuItem icon="$" label="Daily Closing" onPress={() => goTo('/(tabs)/finance/daily-closing' as Href)} />
                <MenuItem icon="⇩" label="Expense Backup / Export" onPress={() => goTo('/(tabs)/finance/export' as Href)} />
                <MenuSectionTitle label="Owner" />
                <MenuItem icon="♙" label="Wafanyakazi" onPress={() => goTo('/(tabs)/profile/users' as Href)} />
                <MenuItem icon="▥" label="Daily Audit Report" onPress={() => goTo('/(tabs)/profile/daily-audit' as Href)} />
                <MenuItem icon="◫" label="Setup Wizard" onPress={() => goTo('/(tabs)/profile/setup-wizard' as Href)} />
                <MenuItem
                  icon="⚙"
                  label="Company Settings"
                  onPress={() => goTo('/(tabs)/profile/company-settings' as Href)}
                />
              </>
            ) : null}
            <MenuItem icon="⚙" label="Wasifu" onPress={() => goTo('/(tabs)/profile' as Href)} />
          </ScrollView>

          <Pressable
            style={styles.logoutButton}
            onPress={async () => {
              onClose();
              await onLogout();
            }}>
            <Text style={styles.logoutText}>Toka</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

function GlobalSearchModal({
  visible,
  query,
  results,
  onChangeQuery,
  onClose,
  onOpenResult,
}: {
  visible: boolean;
  query: string;
  results: { key: string; title: string; meta: string; href: Href }[];
  onChangeQuery: (value: string) => void;
  onClose: () => void;
  onOpenResult: (href: Href) => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.menuOverlay}>
        <Pressable style={styles.menuScrim} onPress={onClose} />
        <View style={styles.searchModal}>
          <View style={styles.searchModalHeader}>
            <Text style={styles.searchModalTitle}>Global Search</Text>
            <Pressable style={styles.menuClose} onPress={onClose}>
              <Text style={styles.menuCloseText}>×</Text>
            </Pressable>
          </View>
          <View style={styles.globalSearchInputWrap}>
            <Text style={styles.globalSearchIcon}>⌕</Text>
            <TextInput
              autoFocus
              value={query}
              onChangeText={onChangeQuery}
              placeholder="Bidhaa, SKU, mteja, sale, deni, invoice..."
              placeholderTextColor="#8994A6"
              style={styles.globalSearchInput}
            />
          </View>
          <ScrollView style={styles.searchResults} keyboardShouldPersistTaps="handled">
            {query.trim() && results.length === 0 ? (
              <View style={styles.clearState}>
                <Text style={styles.clearTitle}>Hakuna kilichopatikana</Text>
                <Text style={styles.clearText}>Jaribu jina la bidhaa, SKU, mteja au document number.</Text>
              </View>
            ) : null}
            {!query.trim() ? (
              <View style={styles.clearState}>
                <Text style={styles.clearTitle}>Tafuta kila kitu sehemu moja</Text>
                <Text style={styles.clearText}>Products, sales, debts na quotations zitaonekana hapa.</Text>
              </View>
            ) : null}
            {results.map((result) => (
              <Pressable
                key={result.key}
                style={({ pressed }) => [styles.searchResultRow, pressed && styles.pressed]}
                onPress={() => onOpenResult(result.href)}>
                <View>
                  <Text style={styles.searchResultTitle}>{result.title}</Text>
                  <Text style={styles.searchResultMeta}>{result.meta}</Text>
                </View>
                <Text style={styles.commandChevron}>›</Text>
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function BranchPicker({
  visible,
  branches,
  selectedBranchId,
  showAllOption = false,
  onSelect,
  onClose,
}: {
  visible: boolean;
  branches: { id: string; name: string }[];
  selectedBranchId: string | null;
  showAllOption?: boolean;
  onSelect: (branchId: string | null) => void;
  onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.menuOverlay}>
        <Pressable style={styles.menuScrim} onPress={onClose} />
        <View style={styles.branchPanel}>
          <Text style={styles.branchTitle}>Chagua Branch</Text>
          {showAllOption ? (
            <Pressable
              style={[styles.branchOption, selectedBranchId === null && styles.branchOptionActive]}
              onPress={() => onSelect(null)}>
              <View>
                <Text style={[styles.branchOptionText, selectedBranchId === null && styles.branchOptionTextActive]}>
                  All branches
                </Text>
                <Text style={styles.branchOptionMeta}>Summary ya branches zote</Text>
              </View>
              {selectedBranchId === null ? <Text style={styles.branchCheck}>✓</Text> : null}
            </Pressable>
          ) : null}
          {branches.map((branch) => {
            const active = branch.id === selectedBranchId;
            return (
              <Pressable
                key={branch.id}
                style={[styles.branchOption, active && styles.branchOptionActive]}
                onPress={() => onSelect(branch.id)}>
                <Text style={[styles.branchOptionText, active && styles.branchOptionTextActive]}>
                  {branch.name}
                </Text>
                {active ? <Text style={styles.branchCheck}>✓</Text> : null}
              </Pressable>
            );
          })}
        </View>
      </View>
    </Modal>
  );
}

function MenuSectionTitle({ label }: { label: string }) {
  return <Text style={styles.menuSectionTitle}>{label}</Text>;
}

function MenuItem({ icon, label, onPress }: { icon: string; label: string; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.menuItem, pressed && styles.pressed]} onPress={onPress}>
      <Text style={styles.menuItemIcon}>{icon}</Text>
      <Text style={styles.menuItemLabel}>{label}</Text>
    </Pressable>
  );
}

function SummaryCard({
  icon,
  title,
  value,
  subtitle,
  rows,
  footerLabel,
  footerValue,
}: {
  icon: string;
  title: string;
  value: string;
  subtitle?: string;
  rows?: [string, string, 'success' | 'warning' | 'danger'][];
  footerLabel?: string;
  footerValue?: string;
}) {
  return (
    <View style={styles.summaryCard}>
      <View style={styles.summaryTop}>
        <View style={styles.summaryIcon}>
          <Text style={styles.summaryIconText}>{icon}</Text>
        </View>
        <Text style={styles.summaryTitle}>{title}</Text>
      </View>
      <Text style={styles.summaryValue}>{value}</Text>
      {subtitle ? <Text style={styles.summarySubtitle}>{subtitle}</Text> : null}
      {rows ? (
        <View style={styles.summaryRows}>
          {rows.map(([label, rowValue, tone]) => (
            <View key={label} style={styles.summaryRow}>
              <Text style={styles.summaryRowLabel}>{label}</Text>
              <Text style={[styles.summaryRowValue, styles[`${tone}Text`]]}>{rowValue}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {footerLabel && footerValue ? (
        <View style={styles.summaryFooter}>
          <Text style={styles.summaryRowLabel}>{footerLabel}</Text>
          <Text style={styles.successText}>{footerValue}</Text>
        </View>
      ) : null}
    </View>
  );
}

function QuickAction({
  label,
  icon,
  fallback,
  href,
  tone,
  badge = 0,
}: {
  label: string;
  icon: AppIconName;
  fallback: string;
  href: Href;
  tone: 'dark' | 'green' | 'teal' | 'blue';
  badge?: number;
}) {
  const filled = tone === 'dark';

  return (
    <Pressable
      style={({ pressed }) => [
        styles.quickAction,
        filled ? styles.darkAction : styles.lightAction,
        tone === 'blue' && styles.lightActionBlue,
        pressed && styles.pressed,
      ]}
      onPress={() => router.push(href)}>
      {badge > 0 ? <Text style={styles.quickBadge}>{badge > 99 ? '99+' : badge}</Text> : null}
      <View style={[styles.quickIcon, filled ? styles.quickIconFilled : styles.quickIconLight]}>
        <AppIcon
          name={icon}
          fallback={fallback}
          size={filled ? 27 : 25}
          color={filled ? Colors.white : Colors.primaryDark}
          fallbackStyle={[styles.quickIconText, filled ? styles.quickIconTextFilled : styles.quickIconTextLight]}
        />
      </View>
      <Text style={[styles.quickLabel, filled ? styles.quickLabelFilled : styles.quickLabelLight]}>{label}</Text>
    </Pressable>
  );
}

function AiBusinessAssistant({
  insights,
  reorderSuggestions,
  showAsk,
  askQuestion,
  askAnswer,
  askExamples,
  onAskQuestionChange,
  onAskSubmit,
  onAskExample,
  onOpenInsight,
  onOpenProduct,
  onOpenStock,
}: {
  insights: AiInsight[];
  reorderSuggestions: AiReorderSuggestion[];
  showAsk: boolean;
  askQuestion: string;
  askAnswer: string;
  askExamples: AiAskExample[];
  onAskQuestionChange: (question: string) => void;
  onAskSubmit: () => void;
  onAskExample: (question: string) => void;
  onOpenInsight: (href: Href) => void;
  onOpenProduct: (productId: string) => void;
  onOpenStock: () => void;
}) {
  return (
    <View style={styles.aiPanel}>
      <View pointerEvents="none" style={styles.aiPanelArtwork}>
        <View style={styles.aiGlowOrbPrimary} />
        <View style={styles.aiGlowOrbSecondary} />
        <View style={styles.aiSoftRingOne} />
        <View style={styles.aiSoftRingTwo} />
        <View style={[styles.aiGraphicStripe, styles.aiGraphicStripeOne]} />
        <View style={[styles.aiGraphicStripe, styles.aiGraphicStripeTwo]} />
        <View style={[styles.aiGraphicStripe, styles.aiGraphicStripeThree]} />
        <View style={[styles.aiGraphicDot, styles.aiGraphicDotOne]} />
        <View style={[styles.aiGraphicDot, styles.aiGraphicDotTwo]} />
        <View style={[styles.aiGraphicDot, styles.aiGraphicDotThree]} />
        <View style={[styles.aiGraphicDot, styles.aiGraphicDotFour]} />
      </View>
      <View style={styles.aiHeroTop}>
        <View style={styles.aiHeroCopy}>
          <View style={styles.aiTitleRow}>
            <Text style={styles.aiTitle}>AI Business Assistant</Text>
            <Text style={styles.aiBadge}>BETA</Text>
          </View>
          <Text style={styles.aiSubtitle}>Uliza swali lolote kuhusu biashara yako</Text>
        </View>
        <AiBotIllustration />
      </View>
      {showAsk ? (
        <>
          <View style={styles.aiAskInputRow}>
            <TextInput
              value={askQuestion}
              onChangeText={onAskQuestionChange}
              onSubmitEditing={onAskSubmit}
              returnKeyType="search"
              placeholder="Mfano: Branch gani imeuza zaidi wiki hii?"
              placeholderTextColor="#8DA39B"
              style={styles.aiAskInput}
            />
            <Pressable style={styles.aiAskButton} onPress={onAskSubmit}>
              <AppIcon name={HomeIcons.send} fallback="➜" size={27} color={Colors.white} fallbackStyle={styles.aiAskButtonText} />
            </Pressable>
          </View>
          <View style={styles.aiAskChips}>
            {askExamples.slice(0, 3).map((example, index) => (
              <Pressable
                key={example.question}
                style={({ pressed }) => [
                  styles.aiAskChip,
                  index === 0 && styles.aiAskChipFirst,
                  index === 1 && styles.aiAskChipWide,
                  index === 2 && styles.aiAskChipCompact,
                  pressed && styles.pressed,
                ]}
                onPress={() => onAskExample(example.question)}>
                <AppIcon
                  name={example.icon}
                  fallback={example.fallback}
                  size={10}
                  color="rgba(255,255,255,0.92)"
                  fallbackStyle={styles.aiAskChipIconFallback}
                />
                <Text
                  numberOfLines={1}
                  adjustsFontSizeToFit
                  minimumFontScale={0.72}
                  style={styles.aiAskChipText}>
                  {example.label}
                </Text>
              </Pressable>
            ))}
          </View>
          {askAnswer ? (
            <View style={styles.aiAnswerGlass}>
              <Text style={styles.aiAskAnswerText}>{askAnswer}</Text>
            </View>
          ) : null}
        </>
      ) : null}
      {!showAsk ? (
        <View style={styles.aiInsightChips}>
          {insights.slice(0, 3).map((insight) => (
            <Pressable
              key={insight.title}
              style={({ pressed }) => [styles.aiInsightChip, pressed && styles.pressed]}
              onPress={() => onOpenInsight(insight.href)}>
              <Text style={styles.aiInsightChipText}>{insight.title.replace('AI: ', '')}</Text>
            </Pressable>
          ))}
          {reorderSuggestions[0] ? (
            <Pressable
              style={({ pressed }) => [styles.aiInsightChip, pressed && styles.pressed]}
              onPress={() => onOpenProduct(reorderSuggestions[0].productId)}>
              <Text style={styles.aiInsightChipText}>Agiza {reorderSuggestions[0].name}</Text>
            </Pressable>
          ) : null}
          <Pressable style={({ pressed }) => [styles.aiInsightChip, pressed && styles.pressed]} onPress={onOpenStock}>
            <Text style={styles.aiInsightChipText}>Stock risk</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function CommandAlert({
  icon,
  title,
  value,
  subtitle,
  tone,
  onPress,
}: {
  icon: string;
  title: string;
  value: string;
  subtitle: string;
  tone: 'success' | 'warning' | 'danger';
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.commandCard,
        tone === 'success' && styles.commandCardSuccess,
        tone === 'warning' && styles.commandCardWarning,
        tone === 'danger' && styles.commandCardDanger,
        pressed && styles.pressed,
      ]}
      onPress={onPress}>
      <View style={styles.commandTop}>
        <View
          style={[
            styles.commandIcon,
            tone === 'success' && styles.commandIconSuccess,
            tone === 'warning' && styles.commandIconWarning,
            tone === 'danger' && styles.commandIconDanger,
          ]}>
          <Text
            style={[
              styles.commandIconText,
              tone === 'success' && styles.successText,
              tone === 'warning' && styles.warningText,
              tone === 'danger' && styles.dangerText,
            ]}>
            {icon}
          </Text>
        </View>
        <Text style={styles.commandChevron}>›</Text>
      </View>
      <Text style={styles.commandTitle}>{title}</Text>
      <Text style={styles.commandValue}>{value}</Text>
      <Text style={styles.commandMeta}>{subtitle}</Text>
    </Pressable>
  );
}

function RecentActivityRow({ item, onPress }: { item: RecentActivityItem; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.activityRow, pressed && styles.pressed]} onPress={onPress}>
      <View
        style={[
          styles.activityDot,
          item.tone === 'success' && styles.activityDotSuccess,
          item.tone === 'warning' && styles.activityDotWarning,
          item.tone === 'danger' && styles.activityDotDanger,
        ]}>
        <Text style={styles.activityDotText}>
          {item.tone === 'success' ? '✓' : item.tone === 'danger' ? '!' : item.tone === 'warning' ? '!' : '•'}
        </Text>
      </View>
      <View style={styles.activityInfo}>
        <Text style={styles.activityTitle}>{item.title}</Text>
        <Text style={styles.activityDetail}>{item.detail}</Text>
      </View>
      {item.amount ? <Text style={[styles.activityAmount, item.tone === 'danger' && styles.dangerText]}>{item.amount}</Text> : null}
    </Pressable>
  );
}

function AiBotIllustration() {
  return (
    <View style={styles.aiBotStage}>
      <View style={styles.aiSparkOne} />
      <View style={styles.aiSparkTwo} />
      <View style={styles.aiBotShadow} />
      <View style={styles.aiBotHeadWrap}>
        <View style={[styles.aiBotEar, styles.aiBotEarLeft]} />
        <View style={[styles.aiBotEar, styles.aiBotEarRight]} />
        <View style={styles.aiBotHead}>
          <View style={styles.aiBotFacePlate}>
            <View style={styles.aiBotEye} />
            <View style={styles.aiBotSmile} />
            <View style={styles.aiBotEye} />
          </View>
        </View>
      </View>
    </View>
  );
}

function PriorityTask({
  title,
  subtitle,
  action,
  tone,
  onPress,
}: {
  title: string;
  subtitle: string;
  action: string;
  tone: 'success' | 'warning' | 'danger';
  onPress: () => void;
}) {
  return (
    <Pressable style={({ pressed }) => [styles.priorityRow, pressed && styles.pressed]} onPress={onPress}>
      <View
        style={[
          styles.priorityMarker,
          tone === 'success' && styles.priorityMarkerSuccess,
          tone === 'warning' && styles.priorityMarkerWarning,
          tone === 'danger' && styles.priorityMarkerDanger,
        ]}
      />
      <View style={styles.priorityInfo}>
        <Text style={styles.priorityTitle}>{title}</Text>
        <Text style={styles.prioritySubtitle}>{subtitle}</Text>
      </View>
      <View style={styles.priorityAction}>
        <Text style={styles.priorityActionText}>{action}</Text>
      </View>
    </Pressable>
  );
}

function NotificationAlertRow({
  title,
  detail,
  tone,
  actionLabel,
  onPress,
}: {
  title: string;
  detail: string;
  tone: 'warning' | 'danger';
  actionLabel: string;
  onPress: () => void;
}) {
  const alertTitle = title.toLowerCase();
  const alertIcon = alertTitle.includes('stock')
    ? HomeIcons.stock
    : alertTitle.includes('cash')
      ? HomeIcons.wallet
      : alertTitle.includes('mawinga') || alertTitle.includes('madeni')
        ? HomeIcons.people
        : HomeIcons.documents;
  const alertFallback = alertTitle.includes('stock')
    ? '□'
    : alertTitle.includes('cash')
      ? '▱'
      : alertTitle.includes('mawinga') || alertTitle.includes('madeni')
        ? '♙'
        : '!';
  const alertColor = tone === 'danger' ? Colors.danger : '#F26F14';

  return (
    <View style={styles.notificationRow}>
      <View style={[styles.notificationIcon, tone === 'danger' ? styles.notificationIconDanger : styles.notificationIconWarning]}>
        <AppIcon
          name={alertIcon}
          fallback={alertFallback}
          size={24}
          color={alertColor}
          fallbackStyle={[styles.notificationIconText, tone === 'danger' ? styles.dangerText : styles.warningText]}
        />
      </View>
      <View style={styles.notificationInfo}>
        <Text style={styles.notificationTitle}>{title}</Text>
        <Text style={styles.notificationDetail}>{detail}</Text>
      </View>
      <Pressable
        style={({ pressed }) => [
          styles.notificationActionButton,
          tone === 'danger' && styles.notificationActionDanger,
          pressed && styles.pressed,
        ]}
        onPress={onPress}>
        <Text style={[styles.notificationActionText, tone === 'danger' && styles.notificationActionDangerText]}>
          {actionLabel}
        </Text>
      </Pressable>
      <AppIcon
        name={HomeIcons.chevron}
        fallback="›"
        size={20}
        color="#8A9A94"
        style={styles.notificationChevronWrap}
        fallbackStyle={styles.notificationChevron}
      />
    </View>
  );
}

function ChecklistRow({ label, detail, done }: { label: string; detail: string; done: boolean }) {
  return (
    <View style={styles.checklistRow}>
      <View style={[styles.checkDot, done ? styles.checkDotDone : styles.checkDotOpen]}>
        <Text style={[styles.checkDotText, done ? styles.checkDotTextDone : styles.checkDotTextOpen]}>{done ? '✓' : '!'}</Text>
      </View>
      <View style={styles.checkInfo}>
        <Text style={styles.checkLabel}>{label}</Text>
        <Text style={styles.checkDetail}>{detail}</Text>
      </View>
      <Text style={[styles.checkStatus, done ? styles.successText : styles.warningText]}>{done ? 'Done' : 'Bado'}</Text>
    </View>
  );
}

function DocumentPipelineStage({
  label,
  count,
  value,
  active,
}: {
  label: string;
  count: number;
  value: number;
  active: boolean;
}) {
  return (
    <View style={[styles.pipelineStage, active && styles.pipelineStageActive]}>
      <Text style={styles.pipelineStageLabel}>{label}</Text>
      <Text style={styles.pipelineStageCount}>{count}</Text>
      <Text style={styles.pipelineStageValue}>TZS {formatMoney(value)}</Text>
    </View>
  );
}

function PulseMetric({ label, value, detail, danger = false }: { label: string; value: string; detail: string; danger?: boolean }) {
  return (
    <View style={[styles.pulseMetric, danger && styles.pulseMetricWarning]}>
      <Text style={styles.pulseLabel}>{label}</Text>
      <Text style={[styles.pulseValue, danger && styles.warningText]}>{value}</Text>
      <Text style={styles.pulseDetail}>{detail}</Text>
    </View>
  );
}

function PaymentMixItem({ label, amount, total }: { label: string; amount: number; total: number }) {
  const percent = total > 0 ? Math.round((amount / total) * 100) : 0;

  return (
    <View style={styles.paymentMixItem}>
      <View style={styles.paymentMixItemTop}>
        <Text style={styles.paymentMixLabel}>{label}</Text>
        <Text style={styles.paymentMixPercent}>{percent}%</Text>
      </View>
      <Text style={styles.paymentMixAmount}>TZS {formatMoney(amount)}</Text>
      <View style={styles.paymentTrack}>
        <View style={[styles.paymentTrackFill, { width: `${percent}%` }]} />
      </View>
    </View>
  );
}

function FastMoverItem({ item, rank, onPress }: { item: FastMoverRow; rank: number; onPress: () => void }) {
  return (
    <Pressable style={({ pressed }) => [styles.fastMoverRow, pressed && styles.pressed]} onPress={onPress}>
      <View style={styles.fastMoverRank}>
        <Text style={styles.fastMoverRankText}>{rank}</Text>
      </View>
      <View style={styles.fastMoverInfo}>
        <Text style={styles.fastMoverName}>{item.name}</Text>
        <Text style={styles.fastMoverMeta}>
          {formatQuantity(item.quantity)} {item.unit || 'pcs'} sold
        </Text>
      </View>
      <View style={styles.fastMoverRight}>
        <Text style={styles.fastMoverRevenue}>TZS {formatMoney(item.revenue)}</Text>
        <Text style={styles.chevron}>›</Text>
      </View>
    </Pressable>
  );
}

function StockRiskItem({ item, onPress }: { item: StockRiskRow; onPress: () => void }) {
  const urgent = item.quantity <= 0 || item.daysCover <= 7;

  return (
    <Pressable style={({ pressed }) => [styles.stockRiskRow, pressed && styles.pressed]} onPress={onPress}>
      <View style={[styles.stockRiskBadge, urgent ? styles.stockRiskBadgeDanger : styles.stockRiskBadgeWarning]}>
        <Text style={[styles.stockRiskBadgeText, urgent ? styles.dangerText : styles.warningText]}>
          {item.quantity <= 0 ? 'Out' : `${item.daysCover}d`}
        </Text>
      </View>
      <View style={styles.stockRiskInfo}>
        <Text style={styles.stockRiskName}>{item.name}</Text>
        <Text style={styles.stockRiskMeta}>
          Stock {formatQuantity(item.quantity)} {item.unit} · sold {formatQuantity(item.soldSevenDays)} siku 7
        </Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

function BranchWatchCard({
  branch,
  active,
  onPress,
}: {
  branch: BranchWatchRow;
  active: boolean;
  onPress: () => void;
}) {
  const hasAttention = branch.lowStock > 0 || branch.dueDebts > 0 || branch.pendingQuotes > 0 || branch.cashExpected < 0;

  return (
    <Pressable style={({ pressed }) => [styles.branchWatchRow, active && styles.branchWatchRowActive, pressed && styles.pressed]} onPress={onPress}>
      <View style={styles.branchWatchTop}>
        <View style={styles.branchWatchNameWrap}>
          <Text style={styles.branchWatchName}>{branch.name}</Text>
          <Text style={styles.branchWatchMeta}>{active ? 'Imechaguliwa sasa' : 'Tap kuchagua branch'}</Text>
        </View>
        <View style={[styles.branchWatchStatus, hasAttention ? styles.branchWatchStatusWarning : styles.branchWatchStatusOk]}>
          <Text style={[styles.branchWatchStatusText, hasAttention ? styles.warningText : styles.successText]}>
            {hasAttention ? 'Angalia' : 'Sawa'}
          </Text>
        </View>
      </View>
      <View style={styles.branchMetricGrid}>
        <BranchMetric label="Sales" value={`TZS ${formatMoney(branch.todaySales)}`} />
        <BranchMetric label="Cash" value={`TZS ${formatMoney(branch.cashExpected)}`} danger={branch.cashExpected < 0} />
        <BranchMetric label="Low" value={String(branch.lowStock)} danger={branch.lowStock > 0} />
        <BranchMetric label="Due" value={String(branch.dueDebts)} danger={branch.dueDebts > 0} />
        <BranchMetric label="Docs" value={String(branch.pendingQuotes)} danger={branch.pendingQuotes > 0} />
      </View>
    </Pressable>
  );
}

function BranchMetric({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <View style={styles.branchMetric}>
      <Text style={styles.branchMetricLabel}>{label}</Text>
      <Text style={[styles.branchMetricValue, danger && styles.dangerText]}>{value}</Text>
    </View>
  );
}

function TransactionRow({
  title,
  subtitle,
  amount,
  tone,
  onPress,
}: {
  title: string;
  subtitle: string;
  amount: string;
  tone: 'success' | 'warning';
  onPress?: () => void;
}) {
  const rowContent = (
    <>
      <View style={[styles.transactionIcon, tone === 'warning' && styles.transactionIconWarning]}>
        <Text style={[styles.transactionIconText, tone === 'warning' && styles.warningText]}>
          {tone === 'warning' ? '!' : '⌑'}
        </Text>
      </View>
      <View style={styles.transactionInfo}>
        <Text style={styles.transactionName}>{title}</Text>
        <Text style={styles.transactionMeta}>{subtitle}</Text>
      </View>
      <View style={styles.transactionRight}>
        <Text style={[styles.transactionAmount, tone === 'warning' && styles.warningText]}>{amount}</Text>
        <Text style={styles.chevron}>›</Text>
      </View>
    </>
  );

  if (onPress) {
    return (
      <Pressable style={({ pressed }) => [styles.transactionRow, pressed && styles.pressed]} onPress={onPress}>
        {rowContent}
      </Pressable>
    );
  }

  return <View style={styles.transactionRow}>{rowContent}</View>;
}

const cardShadow = {
  shadowColor: Colors.primaryDark,
  shadowOffset: { width: 0, height: 16 },
  shadowOpacity: 0.13,
  shadowRadius: 30,
  elevation: 7,
};

const panelBase = {
  backgroundColor: Colors.surface,
  borderRadius: 20,
  borderWidth: 1,
  borderColor: 'rgba(211,232,224,0.95)',
  ...cardShadow,
};

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingTop: 0,
    paddingBottom: 132,
  },
  ownerHero: {
    marginHorizontal: -Spacing.lg,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: 46,
    marginBottom: 58,
    backgroundColor: Colors.primaryDark,
    borderBottomLeftRadius: 34,
    borderBottomRightRadius: 34,
  },
  cashierPanel: {
    ...panelBase,
    padding: Spacing.lg,
    gap: Spacing.md,
  },
  cashierActionGrid: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  cashierBalanceCard: {
    borderWidth: 1,
    borderColor: '#BFE5D6',
    borderRadius: 14,
    backgroundColor: Colors.primarySoft,
    padding: Spacing.lg,
    gap: 4,
  },
  cashierBalanceDanger: {
    borderColor: '#F5C2C7',
    backgroundColor: '#FFF5F5',
  },
  cashierBalanceLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  cashierBalanceValue: {
    color: Colors.primaryDark,
    fontSize: 24,
    fontWeight: '600',
  },
  cashierBalanceMeta: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
  },
  cashierExpensePanel: {
    borderWidth: 1,
    borderColor: '#E2E8E5',
    borderRadius: 14,
    backgroundColor: Colors.surface,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  cashierExpenseHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  cashierExpenseTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  cashierExpenseMeta: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
  cashierExpenseAction: {
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '600',
  },
  cashierExpenseEmpty: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    paddingVertical: Spacing.sm,
  },
  cashierExpenseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: '#E8EEEB',
    paddingTop: Spacing.sm,
    gap: Spacing.md,
  },
  cashierExpenseInfo: {
    flex: 1,
  },
  cashierExpenseName: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  cashierExpenseDetail: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '400',
    marginTop: 2,
  },
  cashierExpenseRight: {
    alignItems: 'flex-end',
    gap: 3,
  },
  cashierExpenseAmount: {
    color: Colors.danger,
    fontSize: 12,
    fontWeight: '600',
  },
  cashierReceiptBadge: {
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: Colors.primarySoft,
    color: Colors.primaryDark,
    fontSize: 10,
    fontWeight: '600',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
  },
  cashierReceiptMissing: {
    backgroundColor: '#FFF5F5',
    color: Colors.danger,
  },
  topHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
    paddingTop: Spacing.xs,
  },
  heroHeader: {
    position: 'relative',
    overflow: 'hidden',
    minHeight: 54,
    marginBottom: Spacing.xl,
  },
  heroHeaderArtwork: {
    ...StyleSheet.absoluteFillObject,
  },
  heroHeaderGlowOne: {
    position: 'absolute',
    right: -48,
    top: -52,
    width: 152,
    height: 152,
    borderRadius: 76,
    backgroundColor: 'rgba(55,232,188,0.17)',
  },
  heroHeaderGlowTwo: {
    position: 'absolute',
    left: 72,
    top: 10,
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: 'rgba(9,117,94,0.24)',
  },
  heroHeaderRingOne: {
    position: 'absolute',
    right: 28,
    top: -18,
    width: 88,
    height: 88,
    borderRadius: 44,
    borderWidth: 1,
    borderColor: 'rgba(190,255,232,0.16)',
  },
  heroHeaderRingTwo: {
    position: 'absolute',
    right: -18,
    top: 6,
    width: 118,
    height: 118,
    borderRadius: 59,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.075)',
  },
  heroHeaderStripe: {
    position: 'absolute',
    height: 7,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.06)',
    transform: [{ rotate: '-22deg' }],
  },
  heroHeaderStripeOne: {
    right: 78,
    top: 7,
    width: 88,
  },
  heroHeaderStripeTwo: {
    right: 46,
    top: 24,
    width: 124,
  },
  heroHeaderStripeThree: {
    right: 94,
    top: 42,
    width: 72,
  },
  heroHeaderDot: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: 'rgba(190,255,232,0.56)',
  },
  heroHeaderDotOne: {
    right: 84,
    top: 2,
    width: 4,
    height: 4,
  },
  heroHeaderDotTwo: {
    right: 16,
    top: 20,
    width: 5,
    height: 5,
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
  heroHeaderDotThree: {
    left: 154,
    bottom: 6,
    width: 3,
    height: 3,
    backgroundColor: 'rgba(105,239,204,0.45)',
  },
  brandRow: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    zIndex: 1,
  },
  brandTextBlock: {
    flex: 1,
    minWidth: 0,
  },
  menuButton: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#F7FFFB',
    borderWidth: 1,
    borderColor: '#CBECDD',
    alignItems: 'center',
    justifyContent: 'center',
    ...cardShadow,
  },
  heroMenuButton: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderColor: 'rgba(255,255,255,0.22)',
    shadowOpacity: 0,
  },
  heroMenuButtonText: {
    color: Colors.white,
  },
  menuButtonText: {
    color: Colors.primaryDark,
    fontSize: 23,
    fontWeight: '600',
    lineHeight: 26,
  },
  greeting: {
    flexShrink: 1,
    color: Colors.text,
    fontSize: 23,
    lineHeight: 28,
    fontWeight: '600',
  },
  heroGreeting: {
    color: Colors.white,
    fontSize: 24,
    lineHeight: 29,
  },
  heroWelcome: {
    color: 'rgba(255,255,255,0.84)',
    fontSize: 12,
    fontWeight: '500',
    lineHeight: 18,
    marginTop: 3,
  },
  storeName: {
    flexShrink: 1,
    color: Colors.primaryDark,
    fontSize: 20,
    lineHeight: 25,
    fontWeight: '600',
    marginTop: 2,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingTop: Spacing.xs,
    zIndex: 1,
  },
  headerIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: '#F7FFFB',
    borderWidth: 1,
    borderColor: '#D7EEE5',
    alignItems: 'center',
    justifyContent: 'center',
    ...cardShadow,
  },
  headerIconText: {
    color: Colors.primary,
    fontSize: 27,
    fontWeight: '600',
  },
  heroBell: {
    width: 44,
    height: 44,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
    backgroundColor: 'rgba(255,255,255,0.14)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroBellText: {
    color: Colors.white,
    fontSize: 26,
    fontWeight: '600',
  },
  heroBellBadge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: Colors.danger,
    color: Colors.white,
    textAlign: 'center',
    lineHeight: 22,
    fontSize: 11,
    fontWeight: '600',
    overflow: 'hidden',
  },
  badgeDot: {
    position: 'absolute',
    top: 0,
    right: 0,
    minWidth: 19,
    height: 19,
    borderRadius: 10,
    backgroundColor: '#10A879',
    color: Colors.white,
    textAlign: 'center',
    lineHeight: 19,
    fontSize: 11,
    fontWeight: '600',
  },
  searchBar: {
    height: 62,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: '#D4E9E0',
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: Spacing.lg,
    marginTop: 0,
    marginBottom: Spacing.xl,
    ...cardShadow,
  },
  searchIconWrap: {
    marginRight: Spacing.md,
  },
  searchIcon: {
    color: '#66758B',
    fontSize: 31,
  },
  searchText: {
    flex: 1,
    color: Colors.textMuted,
    fontSize: 14,
    fontWeight: '400',
  },
  searchDivider: {
    width: 1,
    height: 34,
    backgroundColor: '#DCE3E0',
    marginHorizontal: Spacing.md,
  },
  barcodeIcon: {
    color: Colors.primary,
    fontSize: 26,
    fontWeight: '600',
  },
  filterButton: {
    width: 54,
    height: 54,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#BFE4D8',
    backgroundColor: '#F2FBF7',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: -12,
  },
  filterButtonText: {
    color: Colors.primaryDark,
    fontSize: 22,
    fontWeight: '600',
  },
  branchHeroPanel: {
    position: 'absolute',
    left: Spacing.lg,
    right: Spacing.lg,
    bottom: -48,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.72)',
    backgroundColor: Colors.surface,
    padding: Spacing.md,
    gap: Spacing.sm,
    shadowColor: Colors.primaryDark,
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.22,
    shadowRadius: 28,
    elevation: 14,
  },
  branchHeroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  branchHeroIdentity: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  branchIconBox: {
    width: 44,
    height: 44,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: Colors.primary,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.28,
    shadowRadius: 18,
  },
  branchIconText: {
    color: Colors.white,
    fontSize: 23,
    fontWeight: '600',
  },
  branchHeroText: {
    flex: 1,
    minWidth: 0,
  },
  branchHeroLabel: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
    textTransform: 'uppercase',
  },
  branchHeroName: {
    color: Colors.text,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '600',
    marginTop: 2,
  },
  branchHeroMeta: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
    marginTop: 2,
  },
  branchHeroMode: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: Colors.primarySoft,
    paddingHorizontal: Spacing.md,
    paddingVertical: 7,
  },
  branchHeroModeText: {
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '400',
  },
  branchHeroModeIconFallback: {
    fontSize: 15,
    lineHeight: 17,
  },
  branchHeroDivider: {
    height: 1,
    backgroundColor: '#E2EEE9',
  },
  branchHeroBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  branchOnline: {
    overflow: 'hidden',
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#BFE8DA',
    backgroundColor: Colors.primarySoft,
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 6,
  },
  branchHeroMetrics: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  branchHeroMetric: {
    flexGrow: 1,
    width: '23%',
    minWidth: 130,
    borderWidth: 1,
    borderColor: '#D9EEE5',
    borderRadius: 14,
    backgroundColor: '#F5FCF9',
    padding: Spacing.sm,
  },
  branchHeroMetricWarning: {
    borderColor: '#F4D6A7',
    backgroundColor: '#FFF9EF',
  },
  branchHeroMetricDanger: {
    borderColor: '#F5C2C7',
    backgroundColor: '#FFF5F5',
  },
  branchHeroMetricLabel: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: '500',
  },
  branchHeroMetricValue: {
    color: Colors.primaryDark,
    fontSize: 14,
    fontWeight: '600',
    marginTop: 3,
  },
  branchHeroMetricDetail: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: '400',
    marginTop: 2,
  },
  aiPanel: {
    overflow: 'hidden',
    borderRadius: 22,
    paddingHorizontal: Spacing.lg,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
    marginBottom: Spacing.xl,
    gap: 12,
    backgroundColor: '#064638',
    shadowColor: Colors.primaryDark,
    shadowOffset: { width: 0, height: 20 },
    shadowOpacity: 0.22,
    shadowRadius: 30,
    elevation: 12,
  },
  aiPanelArtwork: {
    ...StyleSheet.absoluteFillObject,
  },
  aiGlowOrbPrimary: {
    position: 'absolute',
    right: -58,
    top: -44,
    width: 178,
    height: 178,
    borderRadius: 89,
    backgroundColor: 'rgba(43, 232, 187, 0.16)',
  },
  aiGlowOrbSecondary: {
    position: 'absolute',
    left: -54,
    bottom: -70,
    width: 176,
    height: 176,
    borderRadius: 88,
    backgroundColor: 'rgba(9, 117, 94, 0.42)',
  },
  aiSoftRingOne: {
    position: 'absolute',
    right: 24,
    top: 22,
    width: 118,
    height: 118,
    borderRadius: 59,
    borderWidth: 1,
    borderColor: 'rgba(184,255,229,0.14)',
  },
  aiSoftRingTwo: {
    position: 'absolute',
    right: -18,
    top: 58,
    width: 168,
    height: 168,
    borderRadius: 84,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.07)',
  },
  aiGraphicStripe: {
    position: 'absolute',
    width: 112,
    height: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.055)',
    transform: [{ rotate: '-22deg' }],
  },
  aiGraphicStripeOne: {
    top: 26,
    right: 72,
  },
  aiGraphicStripeTwo: {
    top: 48,
    right: 42,
    width: 142,
  },
  aiGraphicStripeThree: {
    top: 70,
    right: 86,
    width: 92,
  },
  aiGraphicDot: {
    position: 'absolute',
    borderRadius: 999,
    backgroundColor: 'rgba(172,255,227,0.58)',
  },
  aiGraphicDotOne: {
    top: 24,
    right: 76,
    width: 5,
    height: 5,
  },
  aiGraphicDotTwo: {
    top: 12,
    right: 34,
    width: 4,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
  aiGraphicDotThree: {
    bottom: 32,
    left: 54,
    width: 6,
    height: 6,
    backgroundColor: 'rgba(62,238,195,0.32)',
  },
  aiGraphicDotFour: {
    bottom: 24,
    right: 112,
    width: 3,
    height: 3,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  aiHeroTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
    zIndex: 1,
  },
  aiHeroCopy: {
    flex: 1,
    minWidth: 0,
  },
  aiTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    flexWrap: 'wrap',
  },
  aiTitle: {
    color: Colors.white,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '600',
  },
  aiBadge: {
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.16)',
    color: Colors.white,
    fontSize: 10,
    fontWeight: '600',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 4,
  },
  aiSubtitle: {
    color: 'rgba(255,255,255,0.84)',
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '400',
    marginTop: 6,
  },
  aiBotStage: {
    width: 84,
    height: 82,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 1,
  },
  aiSparkOne: {
    position: 'absolute',
    top: 4,
    left: 4,
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: 'rgba(160,255,223,0.72)',
  },
  aiSparkTwo: {
    position: 'absolute',
    top: 16,
    right: 3,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.72)',
  },
  aiBotShadow: {
    position: 'absolute',
    bottom: 4,
    width: 62,
    height: 13,
    borderRadius: 999,
    backgroundColor: 'rgba(25,204,161,0.28)',
  },
  aiBotHeadWrap: {
    width: 76,
    height: 64,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiBotHead: {
    width: 62,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#F7FFFC',
    borderWidth: 5,
    borderColor: '#82E7D2',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#68F0D5',
    shadowOpacity: 0.42,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
  },
  aiBotFacePlate: {
    width: 43,
    height: 24,
    borderRadius: 14,
    backgroundColor: '#083D34',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  aiBotEye: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: '#39E8BC',
  },
  aiBotSmile: {
    width: 8,
    height: 4,
    borderBottomLeftRadius: 8,
    borderBottomRightRadius: 8,
    borderBottomWidth: 2,
    borderColor: '#39E8BC',
  },
  aiBotEar: {
    position: 'absolute',
    top: 24,
    width: 12,
    height: 24,
    borderRadius: 8,
    backgroundColor: '#37CFB0',
  },
  aiBotEarLeft: {
    left: 2,
  },
  aiBotEarRight: {
    right: 2,
  },
  aiInsightList: {
    gap: Spacing.sm,
  },
  aiInsightRow: {
    minHeight: 62,
    borderWidth: 1,
    borderColor: '#F4D6A7',
    borderRadius: 14,
    backgroundColor: '#FFF9EF',
    padding: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  aiInsightSuccess: {
    borderColor: '#CBECDD',
    backgroundColor: '#F6FFFA',
  },
  aiInsightDanger: {
    borderColor: '#F5C2C7',
    backgroundColor: '#FFF5F5',
  },
  aiInsightInfo: {
    flex: 1,
  },
  aiInsightTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  aiInsightDetail: {
    color: Colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '400',
    marginTop: 2,
  },
  aiInsightAction: {
    overflow: 'hidden',
    borderRadius: 10,
    backgroundColor: Colors.primarySoft,
    color: Colors.primaryDark,
    fontSize: 11,
    fontWeight: '600',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 7,
  },
  aiReorderBox: {
    borderWidth: 1,
    borderColor: '#D8EEE4',
    borderRadius: 15,
    backgroundColor: '#F6FFFA',
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  aiReorderHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  aiReorderTitle: {
    color: Colors.primaryDark,
    fontSize: 13,
    fontWeight: '600',
  },
  aiReorderEmpty: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
  },
  aiReorderRow: {
    minHeight: 56,
    borderTopWidth: 1,
    borderTopColor: '#DCEBE4',
    paddingTop: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  aiReorderInfo: {
    flex: 1,
  },
  aiReorderName: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  aiReorderReason: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  aiReorderQty: {
    maxWidth: 112,
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
  },
  aiAskBox: {
    borderWidth: 1,
    borderColor: '#D6E7E0',
    borderRadius: 12,
    backgroundColor: Colors.surface,
    padding: Spacing.sm,
    gap: Spacing.sm,
  },
  aiAskHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  aiAskTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  aiAskSubtitle: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '400',
    marginTop: 2,
  },
  aiAskScope: {
    alignSelf: 'flex-start',
    minWidth: 58,
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: Colors.accentSoft,
    color: Colors.accent,
    fontSize: 10,
    fontWeight: '600',
    textAlign: 'center',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
  },
  aiAskInputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    padding: 5,
    zIndex: 1,
  },
  aiAskInput: {
    flex: 1,
    minHeight: 50,
    color: Colors.text,
    paddingHorizontal: Spacing.sm,
    fontSize: 12,
    fontWeight: '400',
  },
  aiAskButton: {
    width: 54,
    minHeight: 50,
    borderRadius: 16,
    backgroundColor: Colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  aiAskButtonText: {
    color: Colors.white,
    fontSize: 28,
    fontWeight: '600',
  },
  aiAskChips: {
    flexDirection: 'row',
    flexWrap: 'nowrap',
    gap: 5,
    zIndex: 1,
  },
  aiAskChip: {
    flex: 1.18,
    minWidth: 0,
    minHeight: 39,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.13)',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: 4,
  },
  aiAskChipFirst: {
    flex: 1.33,
  },
  aiAskChipWide: {
    flex: 1.55,
  },
  aiAskChipCompact: {
    flex: 1.25,
  },
  aiAskChipIconFallback: {
    fontSize: 10,
    lineHeight: 12,
  },
  aiAskChipText: {
    color: Colors.white,
    flexShrink: 1,
    fontSize: 7.8,
    lineHeight: 10,
    fontWeight: '500',
    letterSpacing: 0,
  },
  aiAskAnswerBox: {
    borderWidth: 1,
    borderColor: '#E2E8E5',
    borderRadius: 10,
    backgroundColor: '#F8FBFA',
    padding: Spacing.md,
    gap: 3,
  },
  aiAskAnswerLabel: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
  },
  aiAskAnswerText: {
    color: Colors.white,
    fontSize: 13,
    lineHeight: 18,
    fontWeight: '400',
  },
  aiAnswerGlass: {
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.11)',
    padding: Spacing.md,
  },
  aiInsightChips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  aiInsightChip: {
    minHeight: 36,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.11)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  aiInsightChipText: {
    color: 'rgba(255,255,255,0.92)',
    fontSize: 12,
    fontWeight: '400',
  },
  setupPrompt: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#F4D6A7',
    backgroundColor: '#FFF9EF',
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  setupPromptTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  setupPromptText: {
    color: Colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    fontWeight: '400',
    marginTop: 3,
  },
  setupPromptAction: {
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: Colors.primary,
    color: Colors.white,
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  searchModal: {
    position: 'absolute',
    top: 80,
    left: Spacing.lg,
    right: Spacing.lg,
    maxHeight: '78%',
    borderRadius: 18,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: '#DCE3E0',
    padding: Spacing.md,
  },
  searchModalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  searchModalTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '600',
  },
  globalSearchInputWrap: {
    height: 52,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    backgroundColor: Colors.background,
    paddingHorizontal: Spacing.md,
  },
  globalSearchIcon: {
    color: Colors.primary,
    fontSize: 22,
    fontWeight: '600',
  },
  globalSearchInput: {
    flex: 1,
    height: '100%',
    color: Colors.text,
    fontSize: 14,
    fontWeight: '500',
  },
  searchResults: {
    marginTop: Spacing.md,
  },
  searchResultRow: {
    minHeight: 62,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingVertical: Spacing.sm,
  },
  searchResultTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  searchResultMeta: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
  commandPanel: {
    ...panelBase,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  notificationPanel: {
    ...panelBase,
    overflow: 'hidden',
    marginBottom: Spacing.xl,
    paddingTop: Spacing.lg,
  },
  notificationPanelHeader: {
    paddingHorizontal: Spacing.lg,
  },
  notificationClearPanel: {
    ...panelBase,
    padding: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  notificationRow: {
    minHeight: 78,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: '#E8EEEB',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  notificationIcon: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  notificationIconWarning: {
    backgroundColor: '#FFF1DD',
  },
  notificationIconDanger: {
    backgroundColor: '#FFE7EA',
  },
  notificationIconText: {
    fontSize: 23,
    fontWeight: '600',
  },
  notificationInfo: {
    flex: 1,
  },
  notificationTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  notificationDetail: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 16,
    marginTop: 2,
  },
  notificationActionButton: {
    minHeight: 40,
    maxWidth: 136,
    borderRadius: 12,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    borderWidth: 1,
    borderColor: '#BFE8DA',
  },
  notificationActionDanger: {
    backgroundColor: '#FFE7EA',
    borderColor: '#F7C0C5',
  },
  notificationActionText: {
    color: Colors.primaryDark,
    fontSize: 11,
    fontWeight: '600',
    textAlign: 'center',
  },
  notificationActionDangerText: {
    color: Colors.danger,
  },
  notificationChevron: {
    color: '#8A9A94',
    fontSize: 28,
    fontWeight: '600',
  },
  notificationChevronWrap: {
    marginLeft: -Spacing.xs,
  },
  commandSubtitle: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
  commandGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  viewMoreButton: {
    minHeight: 32,
    borderRadius: 10,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  viewMoreText: {
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '400',
  },
  collapsedSummary: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 18,
    borderTopWidth: 1,
    borderTopColor: '#E8EEEB',
    paddingTop: Spacing.md,
  },
  panelInlineAction: {
    minHeight: 40,
    borderRadius: 12,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: Spacing.sm,
  },
  panelInlineActionText: {
    color: Colors.primaryDark,
    fontSize: 13,
    fontWeight: '600',
  },
  commandCard: {
    width: '48.5%',
    minHeight: 142,
    borderRadius: 13,
    borderWidth: 1,
    borderColor: '#E2E8E5',
    backgroundColor: Colors.surface,
    padding: Spacing.md,
  },
  commandCardSuccess: {
    borderColor: '#CBECDD',
    backgroundColor: '#F6FFFA',
  },
  commandCardWarning: {
    borderColor: '#F4D6A7',
    backgroundColor: '#FFF9EF',
  },
  commandCardDanger: {
    borderColor: '#F5C2C7',
    backgroundColor: '#FFF5F5',
  },
  commandTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.sm,
  },
  commandIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.primarySoft,
  },
  commandIconSuccess: { backgroundColor: '#E1F8EE' },
  commandIconWarning: { backgroundColor: '#FFF1DD' },
  commandIconDanger: { backgroundColor: '#FFE7EA' },
  commandIconText: {
    color: Colors.primary,
    fontSize: 16,
    fontWeight: '600',
  },
  commandChevron: {
    color: '#7B8796',
    fontSize: 24,
    fontWeight: '600',
  },
  commandTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  commandValue: {
    color: Colors.text,
    fontSize: 18,
    lineHeight: 23,
    fontWeight: '600',
    marginTop: Spacing.xs,
  },
  commandMeta: {
    color: Colors.textMuted,
    fontSize: 11,
    lineHeight: 15,
    fontWeight: '400',
    marginTop: Spacing.xs,
  },
  documentPipelinePanel: {
    ...panelBase,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  pipelineGrid: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  pipelineStage: {
    flex: 1,
    minHeight: 86,
    borderWidth: 1,
    borderColor: '#E2E8E5',
    borderRadius: 12,
    backgroundColor: Colors.surface,
    padding: Spacing.sm,
  },
  pipelineStageActive: {
    borderColor: '#F4D6A7',
    backgroundColor: '#FFF9EF',
  },
  pipelineStageLabel: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
  },
  pipelineStageCount: {
    color: Colors.text,
    fontSize: 22,
    lineHeight: 27,
    fontWeight: '600',
    marginTop: Spacing.xs,
  },
  pipelineStageValue: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  priorityPanel: {
    ...panelBase,
    overflow: 'hidden',
    marginBottom: Spacing.lg,
  },
  priorityRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#E8EEEB',
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    gap: Spacing.md,
  },
  priorityMarker: {
    width: 8,
    height: 38,
    borderRadius: 5,
    backgroundColor: Colors.primary,
  },
  priorityMarkerSuccess: { backgroundColor: Colors.success },
  priorityMarkerWarning: { backgroundColor: '#F26F14' },
  priorityMarkerDanger: { backgroundColor: Colors.danger },
  priorityInfo: {
    flex: 1,
  },
  priorityTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  prioritySubtitle: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
  priorityAction: {
    minHeight: 32,
    borderRadius: 10,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  priorityActionText: {
    color: Colors.primaryDark,
    fontSize: 11,
    fontWeight: '600',
  },
  clearState: {
    borderTopWidth: 1,
    borderTopColor: '#E8EEEB',
    padding: Spacing.lg,
  },
  clearTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  clearText: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: '400',
    lineHeight: 18,
    marginTop: Spacing.xs,
  },
  checklistPanel: {
    ...panelBase,
    overflow: 'hidden',
    marginBottom: Spacing.lg,
  },
  checklistRow: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#E8EEEB',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    gap: Spacing.md,
  },
  checkDot: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkDotDone: {
    backgroundColor: '#E1F8EE',
  },
  checkDotOpen: {
    backgroundColor: '#FFF1DD',
  },
  checkDotText: {
    fontSize: 13,
    fontWeight: '600',
  },
  checkDotTextDone: {
    color: Colors.success,
  },
  checkDotTextOpen: {
    color: '#F26F14',
  },
  checkInfo: {
    flex: 1,
  },
  checkLabel: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '500',
  },
  checkDetail: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
  checkStatus: {
    fontSize: 12,
    fontWeight: '600',
  },
  checklistAction: {
    minHeight: 46,
    margin: Spacing.md,
    marginTop: Spacing.sm,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checklistActionText: {
    color: Colors.white,
    fontSize: 14,
    fontWeight: '600',
  },
  branchWatchPanel: {
    ...panelBase,
    overflow: 'hidden',
    marginBottom: Spacing.lg,
  },
  branchWatchRow: {
    borderTopWidth: 1,
    borderTopColor: '#E8EEEB',
    backgroundColor: Colors.surface,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  branchWatchRowActive: {
    backgroundColor: Colors.primarySoft,
  },
  branchWatchTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  branchWatchNameWrap: {
    flex: 1,
  },
  branchWatchName: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  branchWatchMeta: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
  branchWatchStatus: {
    minHeight: 28,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  branchWatchStatusOk: {
    backgroundColor: '#E1F8EE',
  },
  branchWatchStatusWarning: {
    backgroundColor: '#FFF1DD',
  },
  branchWatchStatusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  branchMetricGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  branchMetric: {
    minWidth: '18%',
    flexGrow: 1,
    borderWidth: 1,
    borderColor: '#E2E8E5',
    borderRadius: 9,
    backgroundColor: Colors.surface,
    padding: Spacing.xs,
  },
  branchMetricLabel: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: '500',
  },
  branchMetricValue: {
    color: Colors.text,
    fontSize: 11,
    fontWeight: '600',
    marginTop: 2,
  },
  auditPanel: {
    ...panelBase,
    overflow: 'hidden',
    marginBottom: Spacing.lg,
  },
  activityPanel: {
    ...panelBase,
    overflow: 'hidden',
    marginBottom: Spacing.xl,
  },
  activityRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: '#E8EEEB',
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
  },
  activityDot: {
    width: 32,
    height: 32,
    borderRadius: 12,
    backgroundColor: Colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  activityDotSuccess: {
    backgroundColor: '#E1F8EE',
  },
  activityDotWarning: {
    backgroundColor: '#FFF1DD',
  },
  activityDotDanger: {
    backgroundColor: '#FFE7EA',
  },
  activityDotText: {
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '600',
  },
  activityInfo: {
    flex: 1,
    minWidth: 0,
  },
  activityTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600',
    lineHeight: 17,
  },
  activityDetail: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 17,
    marginTop: 2,
    flexShrink: 1,
  },
  activityAmount: {
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
    maxWidth: 108,
    flexShrink: 0,
    marginTop: 2,
  },
  auditRow: {
    borderTopWidth: 1,
    borderTopColor: '#E8EEEB',
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
  },
  auditTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  auditMeta: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
  heroRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.xl,
  },
  primarySalesCard: {
    flex: 1,
    minHeight: 168,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#D7EAE2',
    padding: Spacing.md,
    backgroundColor: Colors.surface,
    ...cardShadow,
  },
  primaryCardLabel: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: '500',
  },
  primaryCardValue: {
    color: Colors.text,
    fontSize: 21,
    lineHeight: 27,
    fontWeight: '600',
    marginTop: 6,
  },
  primaryCardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginTop: Spacing.md,
  },
  primaryCardMeta: {
    color: Colors.textMuted,
    fontSize: 12,
    lineHeight: 16,
    fontWeight: '400',
    marginTop: Spacing.sm,
  },
  primaryCardTrend: {
    alignSelf: 'flex-start',
    overflow: 'hidden',
    borderRadius: 999,
    backgroundColor: Colors.primarySoft,
    color: Colors.primary,
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 5,
    marginTop: Spacing.sm,
  },
  chartIcon: {
    position: 'absolute',
    top: Spacing.md,
    right: Spacing.md,
    width: 42,
    height: 42,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  chartIconText: {
    color: Colors.white,
    fontSize: 24,
    fontWeight: '600',
  },
  debtCard: {
    flex: 0.9,
    minHeight: 165,
    borderRadius: 12,
    padding: Spacing.lg,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: '#E6ECE9',
    justifyContent: 'space-between',
    ...cardShadow,
  },
  ordersCard: {
    flex: 0.84,
    minHeight: 168,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#D7EAE2',
    padding: Spacing.md,
    backgroundColor: Colors.surface,
    ...cardShadow,
  },
  ordersValue: {
    color: Colors.text,
    fontSize: 34,
    lineHeight: 42,
    fontWeight: '600',
    marginTop: Spacing.md,
  },
  ordersIcon: {
    position: 'absolute',
    top: Spacing.md,
    right: Spacing.md,
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ordersIconText: {
    color: Colors.primary,
    fontSize: 24,
    fontWeight: '600',
  },
  metricSparkline: {
    position: 'absolute',
    right: Spacing.md,
    bottom: Spacing.md,
    height: 50,
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
  },
  sparkBar: {
    width: 5,
    borderRadius: 4,
    backgroundColor: Colors.primary,
  },
  debtTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  debtValue: {
    color: '#F26F14',
    fontSize: 18,
    lineHeight: 25,
    fontWeight: '600',
  },
  debtMeta: {
    color: Colors.textMuted,
    fontSize: 14,
    fontWeight: '400',
  },
  debtFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  debtSubMeta: {
    flex: 1,
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
  },
  debtAlert: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: '#FF7900',
    color: '#FF7900',
    textAlign: 'center',
    lineHeight: 24,
    fontWeight: '600',
  },
  salesPulsePanel: {
    ...panelBase,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  pulseGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  pulseMetric: {
    width: '48.5%',
    minHeight: 86,
    borderWidth: 1,
    borderColor: '#E2E8E5',
    borderRadius: 12,
    backgroundColor: Colors.surface,
    padding: Spacing.md,
  },
  pulseMetricWarning: {
    borderColor: '#F4D6A7',
    backgroundColor: '#FFF9EF',
  },
  pulseLabel: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
  },
  pulseValue: {
    color: Colors.text,
    fontSize: 16,
    lineHeight: 21,
    fontWeight: '600',
    marginTop: Spacing.xs,
  },
  pulseDetail: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '400',
    marginTop: 2,
  },
  paymentMixPanel: {
    ...panelBase,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  paymentMixTotalRow: {
    minHeight: 56,
    borderWidth: 1,
    borderColor: '#E2E8E5',
    borderRadius: 12,
    backgroundColor: Colors.primarySoft,
    padding: Spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    marginBottom: Spacing.sm,
  },
  paymentMixTotalLabel: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
  },
  paymentMixTotalValue: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: '600',
    marginTop: 2,
  },
  paymentMixCredit: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
  },
  paymentMixGrid: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  paymentMixItem: {
    flex: 1,
    minHeight: 82,
    borderWidth: 1,
    borderColor: '#E2E8E5',
    borderRadius: 12,
    backgroundColor: Colors.surface,
    padding: Spacing.sm,
  },
  paymentMixItemTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.xs,
  },
  paymentMixLabel: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '500',
  },
  paymentMixPercent: {
    color: Colors.primary,
    fontSize: 11,
    fontWeight: '600',
  },
  paymentMixAmount: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '600',
    marginTop: Spacing.xs,
  },
  paymentTrack: {
    height: 5,
    borderRadius: 4,
    backgroundColor: '#E8EEEB',
    overflow: 'hidden',
    marginTop: 'auto',
  },
  paymentTrackFill: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: Colors.primary,
  },
  fastMoverPanel: {
    ...panelBase,
    overflow: 'hidden',
    marginBottom: Spacing.lg,
  },
  fastMoverRow: {
    minHeight: 68,
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#E8EEEB',
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  fastMoverRank: {
    width: 34,
    height: 34,
    borderRadius: 12,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fastMoverRankText: {
    color: Colors.primaryDark,
    fontSize: 13,
    fontWeight: '600',
  },
  fastMoverInfo: {
    flex: 1,
  },
  fastMoverName: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  fastMoverMeta: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
  fastMoverRight: {
    minWidth: 112,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  fastMoverRevenue: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  stockRiskPanel: {
    ...panelBase,
    overflow: 'hidden',
    marginBottom: Spacing.lg,
  },
  stockRiskRow: {
    minHeight: 66,
    flexDirection: 'row',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#E8EEEB',
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.lg,
    gap: Spacing.md,
  },
  stockRiskBadge: {
    minWidth: 42,
    height: 34,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xs,
  },
  stockRiskBadgeWarning: {
    backgroundColor: '#FFF1DD',
  },
  stockRiskBadgeDanger: {
    backgroundColor: '#FFE7EA',
  },
  stockRiskBadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  stockRiskInfo: {
    flex: 1,
  },
  stockRiskName: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  stockRiskMeta: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
  summaryPanel: {
    ...panelBase,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  panelHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.md,
    gap: Spacing.sm,
    paddingHorizontal: Spacing.sm,
  },
  panelHeaderText: {
    flex: 1,
    minWidth: 0,
  },
  sectionTitle: {
    flexShrink: 1,
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
    marginLeft: 2,
  },
  updatedText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
  },
  summaryGrid: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  summaryCard: {
    flex: 1,
    minHeight: 154,
    borderWidth: 1,
    borderColor: '#E2E8E5',
    borderRadius: 12,
    padding: Spacing.sm,
    backgroundColor: Colors.surface,
  },
  summaryTop: {
    minHeight: 42,
    gap: Spacing.xs,
  },
  summaryIcon: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryIconText: {
    color: Colors.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  summaryTitle: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '600',
  },
  summaryValue: {
    color: Colors.text,
    fontSize: 20,
    lineHeight: 24,
    fontWeight: '600',
    marginTop: Spacing.sm,
  },
  summarySubtitle: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '400',
  },
  summaryRows: {
    borderTopWidth: 1,
    borderTopColor: '#E8EEEB',
    marginTop: Spacing.sm,
    paddingTop: Spacing.sm,
    gap: 4,
  },
  summaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 4,
  },
  summaryRowLabel: {
    color: Colors.textMuted,
    fontSize: 10,
    fontWeight: '500',
  },
  summaryRowValue: {
    fontSize: 11,
    fontWeight: '600',
  },
  summaryFooter: {
    borderTopWidth: 1,
    borderTopColor: '#E8EEEB',
    marginTop: 'auto',
    paddingTop: Spacing.sm,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 4,
  },
  successText: {
    color: Colors.success,
    fontWeight: '400',
  },
  warningText: {
    color: '#F26F14',
    fontWeight: '400',
  },
  dangerText: {
    color: Colors.danger,
    fontWeight: '400',
  },
  quickPanel: {
    marginBottom: Spacing.xl,
  },
  quickGrid: {
    flexDirection: 'row',
    gap: 5,
    marginTop: Spacing.sm,
    paddingRight: 0,
  },
  quickAction: {
    width: 56,
    minHeight: 82,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#D8E9E1',
    shadowColor: Colors.primaryDark,
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 5,
  },
  quickBadge: {
    position: 'absolute',
    top: 5,
    right: 3,
    minWidth: 19,
    height: 19,
    borderRadius: 10,
    backgroundColor: '#FF7900',
    color: Colors.white,
    textAlign: 'center',
    lineHeight: 19,
    fontSize: 10,
    fontWeight: '600',
    overflow: 'hidden',
  },
  darkAction: {
    borderColor: 'rgba(255,255,255,0.16)',
    backgroundColor: Colors.primaryDark,
  },
  lightAction: {
    backgroundColor: Colors.surface,
  },
  lightActionBlue: {
    borderColor: '#CFE9EE',
  },
  pressed: {
    opacity: 0.82,
  },
  quickIcon: {
    width: 36,
    height: 36,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickIconFilled: {
    backgroundColor: 'rgba(255,255,255,0.18)',
  },
  quickIconLight: {
    backgroundColor: Colors.primarySoft,
  },
  quickIconText: {
    fontWeight: '600',
    fontSize: 22,
  },
  quickIconTextFilled: {
    color: Colors.white,
  },
  quickIconTextLight: {
    color: Colors.primaryDark,
  },
  quickLabel: {
    fontSize: 9,
    lineHeight: 11,
    fontWeight: '500',
    textAlign: 'center',
  },
  quickLabelFilled: {
    color: Colors.white,
  },
  quickLabelLight: {
    color: Colors.text,
  },
  branchAttentionPanel: {
    ...panelBase,
    overflow: 'hidden',
    marginBottom: Spacing.lg,
  },
  branchAttentionRow: {
    minHeight: 58,
    borderTopWidth: 1,
    borderTopColor: '#E8EEEB',
    backgroundColor: '#FFF9EF',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  branchAttentionInfo: {
    flex: 1,
  },
  branchAttentionName: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  branchAttentionMeta: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
  branchAttentionAction: {
    minWidth: 58,
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'right',
  },
  transactionsPanel: {
    ...panelBase,
    overflow: 'hidden',
    marginBottom: Spacing.lg,
  },
  linkText: {
    color: Colors.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  emptyTransaction: {
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
  },
  emptyPanel: {
    ...panelBase,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  emptyTitle: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '600',
    marginBottom: Spacing.xs,
  },
  emptyText: {
    color: Colors.textMuted,
    fontSize: 14,
  },
  transactionRow: {
    minHeight: 72,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.surface,
    borderTopWidth: 1,
    borderTopColor: '#E8EEEB',
    paddingHorizontal: Spacing.lg,
  },
  transactionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: Spacing.md,
  },
  transactionIconWarning: {
    backgroundColor: '#FFF1DD',
  },
  transactionIconText: {
    color: Colors.primary,
    fontSize: 18,
    fontWeight: '600',
  },
  transactionInfo: {
    flex: 1,
    marginRight: Spacing.sm,
  },
  transactionName: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  transactionMeta: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
  transactionRight: {
    alignItems: 'flex-end',
    justifyContent: 'center',
    minWidth: 88,
  },
  transactionAmount: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600',
  },
  chevron: {
    position: 'absolute',
    right: -10,
    color: '#7B8796',
    fontSize: 30,
    fontWeight: '500',
  },
  stockHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: Spacing.sm,
    paddingHorizontal: Spacing.sm,
  },
  warningCount: {
    minWidth: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: Colors.warningSoft,
    color: '#A46100',
    textAlign: 'center',
    lineHeight: 28,
    fontWeight: '600',
  },
  menuOverlay: {
    flex: 1,
    flexDirection: 'row',
  },
  menuScrim: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(16, 34, 28, 0.42)',
  },
  menuPanel: {
    width: '82%',
    maxWidth: 330,
    height: '100%',
    backgroundColor: Colors.surface,
    paddingTop: 54,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.xl,
  },
  branchPanel: {
    alignSelf: 'center',
    width: '88%',
    maxWidth: 420,
    marginTop: 'auto',
    marginBottom: Spacing.xl,
    borderRadius: 18,
    backgroundColor: Colors.surface,
    padding: Spacing.lg,
    ...cardShadow,
  },
  branchTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '600',
    marginBottom: Spacing.md,
  },
  branchOption: {
    minHeight: 52,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  branchOptionActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primarySoft,
  },
  branchOptionText: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '400',
  },
  branchOptionTextActive: {
    color: Colors.primaryDark,
  },
  branchOptionMeta: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '400',
    marginTop: 2,
  },
  branchCheck: {
    color: Colors.primaryDark,
    fontSize: 18,
    fontWeight: '600',
  },
  menuHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: Spacing.xl,
    gap: Spacing.md,
  },
  menuAvatar: {
    width: 48,
    height: 48,
    borderRadius: 14,
    backgroundColor: Colors.primaryDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuAvatarText: {
    color: Colors.white,
    fontSize: 18,
    fontWeight: '600',
  },
  menuHeaderText: {
    flex: 1,
  },
  menuTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '600',
  },
  menuSubtitle: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: '400',
    marginTop: 2,
  },
  menuClose: {
    width: 34,
    height: 34,
    borderRadius: 10,
    backgroundColor: Colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  menuCloseText: {
    color: Colors.text,
    fontSize: 24,
    lineHeight: 28,
    fontWeight: '600',
  },
  menuScroll: {
    flex: 1,
    marginHorizontal: -Spacing.xs,
    paddingHorizontal: Spacing.xs,
  },
  menuItems: {
    gap: Spacing.sm,
    paddingBottom: Spacing.lg,
  },
  menuSectionTitle: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '600',
    letterSpacing: 0,
    marginTop: Spacing.xs,
    paddingHorizontal: Spacing.sm,
    textTransform: 'uppercase',
  },
  menuItem: {
    minHeight: 48,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.surfaceMuted,
  },
  menuItemIcon: {
    width: 28,
    color: Colors.primaryDark,
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center',
  },
  menuItemLabel: {
    color: Colors.text,
    fontSize: 15,
    fontWeight: '500',
  },
  logoutButton: {
    marginTop: Spacing.md,
    height: 46,
    borderRadius: 12,
    backgroundColor: '#FFF0EC',
    borderWidth: 1,
    borderColor: '#F4C7BC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoutText: {
    color: Colors.danger,
    fontSize: 15,
    fontWeight: '600',
  },
});
