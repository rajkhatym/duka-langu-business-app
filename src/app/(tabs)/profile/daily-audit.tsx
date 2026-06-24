import { router, useFocusEffect } from 'expo-router';
import type React from 'react';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Screen } from '@/components/screen';
import { Colors, Radius, Spacing } from '@/constants/colors';
import { isAnyPreviewMode, useAuth } from '@/lib/auth-context';
import { useBranch } from '@/lib/branch-context';
import { formatDateTime, formatMoney, formatQuantity } from '@/lib/format';
import { getLocalStoreLogBookEntries } from '@/lib/local-store-log-book';
import { getPreviewData } from '@/lib/preview-data';
import { supabase } from '@/lib/supabase';
import type { AuditLog, Debt, Expense, Sale, StockTransfer, StoreLogBookEntry } from '@/types/database';

function startOfTodayIso() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

function actionLabel(log: AuditLog) {
  if (log.table_name === 'products' && log.action === 'UPDATE') return 'Price/stock changed';
  if (log.action === 'INSERT') return `Added ${log.table_name}`;
  if (log.action === 'UPDATE') return `Changed ${log.table_name}`;
  if (log.action === 'DELETE') return `Deleted ${log.table_name}`;
  return `${log.action} ${log.table_name}`;
}

function storeStatus(status?: StoreLogBookEntry['status']) {
  if (status === 'approved') return 'Approved';
  if (status === 'rejected') return 'Rejected';
  return 'Pending';
}

export default function DailyAuditReportScreen() {
  const { isOwner } = useAuth();
  const { selectedBranchId, selectedBranch } = useBranch();
  const previewMode = isAnyPreviewMode();
  const [sales, setSales] = useState<Sale[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [transfers, setTransfers] = useState<StockTransfer[]>([]);
  const [storeLogs, setStoreLogs] = useState<StoreLogBookEntry[]>([]);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const from = startOfTodayIso();
    setNotice(null);

    if (previewMode) {
      const preview = getPreviewData(selectedBranchId);
      setSales(preview.sales.filter((sale) => sale.created_at >= from));
      setExpenses(preview.expenses.filter((expense) => expense.created_at >= from));
      setTransfers([]);
      setStoreLogs(await getLocalStoreLogBookEntries(selectedBranchId));
      setDebts(preview.debts.filter((debt) => debt.created_at >= from));
      setAuditLogs([]);
      return;
    }

    const [salesRes, expensesRes, transfersRes, storeRes, debtsRes, auditRes] = await Promise.all([
      supabase
        .from('sales')
        .select('*, products(id,name,unit,sku,cost_price,warranty_months), profiles(id,full_name)')
        .eq('branch_id', selectedBranchId)
        .gte('created_at', from)
        .order('created_at', { ascending: false }),
      supabase
        .from('expenses')
        .select('*, profiles(id,full_name)')
        .eq('branch_id', selectedBranchId)
        .gte('created_at', from)
        .order('created_at', { ascending: false }),
      supabase
        .from('stock_transfers')
        .select('*, products(id,name,unit,sku), profiles(id,full_name)')
        .or(`from_branch_id.eq.${selectedBranchId},to_branch_id.eq.${selectedBranchId}`)
        .gte('created_at', from)
        .order('created_at', { ascending: false }),
      supabase
        .from('store_log_book')
        .select('*, products(id,name,unit,sku), profiles(id,full_name)')
        .eq('branch_id', selectedBranchId)
        .gte('created_at', from)
        .order('created_at', { ascending: false }),
      supabase
        .from('debts')
        .select('*, profiles(id,full_name)')
        .eq('branch_id', selectedBranchId)
        .gte('created_at', from)
        .order('created_at', { ascending: false }),
      supabase
        .from('audit_logs')
        .select('*')
        .eq('branch_id', selectedBranchId)
        .gte('created_at', from)
        .in('table_name', ['products', 'sales', 'expenses', 'stock_movements', 'stock_transfers', 'debts', 'store_log_book'])
        .order('created_at', { ascending: false })
        .limit(50),
    ]);

    if (storeRes.error?.message.includes('store_log_book')) {
      setNotice('Run SQL mpya ya Store Log Book approval ili report isome store logs.');
    }

    setSales((salesRes.data as Sale[]) ?? []);
    setExpenses((expensesRes.data as Expense[]) ?? []);
    setTransfers((transfersRes.data as StockTransfer[]) ?? []);
    setStoreLogs((storeRes.data as StoreLogBookEntry[]) ?? []);
    setDebts((debtsRes.data as Debt[]) ?? []);
    setAuditLogs((auditRes.data as AuditLog[]) ?? []);
  }, [previewMode, selectedBranchId]);

  useFocusEffect(
    useCallback(() => {
      if (!isOwner) {
        router.back();
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
    }, [isOwner, load])
  );

  const salesTotal = useMemo(() => sales.reduce((sum, sale) => sum + sale.quantity * sale.unit_price, 0), [sales]);
  const expenseTotal = useMemo(() => expenses.reduce((sum, expense) => sum + expense.amount, 0), [expenses]);
  const debtTotal = useMemo(() => debts.reduce((sum, debt) => sum + Math.max(debt.amount - debt.amount_paid, 0), 0), [debts]);
  const pendingStoreLogs = useMemo(() => storeLogs.filter((entry) => (entry.status ?? 'pending') === 'pending').length, [storeLogs]);

  if (!isOwner) return null;

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Daily Audit Report</Text>
        <Text style={styles.subtitle}>{selectedBranch?.name ?? 'Branch'} · Leo nini kimetokea</Text>
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={Colors.primary} />
          </View>
        ) : (
          <>
            <View style={styles.summaryGrid}>
              <SummaryCard label="Sales" value={`TZS ${formatMoney(salesTotal)}`} />
              <SummaryCard label="Expenses" value={`TZS ${formatMoney(expenseTotal)}`} />
              <SummaryCard label="Pending Store Logs" value={String(pendingStoreLogs)} />
              <SummaryCard label="Debts Opened" value={`TZS ${formatMoney(debtTotal)}`} />
            </View>

            <AuditSection title="Mauzo Leo" empty="Hakuna mauzo leo.">
              {sales.map((sale) => (
                <AuditItem
                  key={sale.id}
                  title={sale.products?.name ?? 'Sale'}
                  meta={`${formatQuantity(sale.quantity)} ${sale.products?.unit ?? ''} · ${formatDateTime(sale.created_at)}`}
                  value={`TZS ${formatMoney(sale.quantity * sale.unit_price)}`}
                />
              ))}
            </AuditSection>

            <AuditSection title="Matumizi Leo" empty="Hakuna matumizi leo.">
              {expenses.map((expense) => (
                <AuditItem
                  key={expense.id}
                  title={expense.title}
                  meta={`${expense.category ?? 'Matumizi'} · ${expense.profiles?.full_name ?? 'Mtumiaji'} · ${formatDateTime(expense.created_at)}`}
                  value={`TZS ${formatMoney(expense.amount)}`}
                />
              ))}
            </AuditSection>

            <AuditSection title="Stock Transfers" empty="Hakuna transfer leo.">
              {transfers.map((transfer) => (
                <AuditItem
                  key={transfer.id}
                  title={transfer.products?.name ?? 'Transfer'}
                  meta={`${transfer.from_branch_id} -> ${transfer.to_branch_id} · ${formatDateTime(transfer.created_at)}`}
                  value={`${formatQuantity(transfer.quantity)} ${transfer.products?.unit ?? 'pcs'}`}
                />
              ))}
            </AuditSection>

            <AuditSection title="Store Log Book" empty="Hakuna store log leo.">
              {storeLogs.map((entry) => (
                <AuditItem
                  key={entry.id}
                  title={entry.product_name || entry.products?.name || 'Store item'}
                  meta={`${entry.person_name} · ${storeStatus(entry.status)} · ${formatDateTime(entry.created_at)}`}
                  value={`${formatQuantity(entry.quantity)} ${entry.unit ?? entry.products?.unit ?? 'pcs'}`}
                />
              ))}
            </AuditSection>

            <AuditSection title="Debt Payments / Debts" empty="Hakuna deni lililorekodiwa leo.">
              {debts.map((debt) => (
                <AuditItem
                  key={debt.id}
                  title={debt.customer_name}
                  meta={`${debt.status} · paid TZS ${formatMoney(debt.amount_paid)} · ${formatDateTime(debt.created_at)}`}
                  value={`Balance TZS ${formatMoney(Math.max(debt.amount - debt.amount_paid, 0))}`}
                />
              ))}
            </AuditSection>

            <AuditSection title="Price / Stock / Audit Events" empty="Hakuna audit event leo.">
              {auditLogs.map((log) => (
                <AuditItem
                  key={log.id}
                  title={actionLabel(log)}
                  meta={`${log.actor_id ? `User ${log.actor_id.slice(0, 8)}` : 'System'} · ${formatDateTime(log.created_at)}`}
                  value={log.record_id ? log.record_id.slice(0, 8) : ''}
                />
              ))}
            </AuditSection>
          </>
        )}
      </ScrollView>
    </Screen>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

function AuditSection({ title, empty, children }: { title: string; empty: string; children: React.ReactNode }) {
  const hasItems = Array.isArray(children) ? children.length > 0 : Boolean(children);
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      {hasItems ? children : <Text style={styles.emptyText}>{empty}</Text>}
    </View>
  );
}

function AuditItem({ title, meta, value }: { title: string; meta: string; value: string }) {
  return (
    <View style={styles.item}>
      <View style={styles.itemInfo}>
        <Text style={styles.itemTitle}>{title}</Text>
        <Text style={styles.itemMeta}>{meta}</Text>
      </View>
      {value ? <Text style={styles.itemValue}>{value}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingTop: Spacing.lg,
    paddingBottom: 140,
  },
  title: {
    color: Colors.text,
    fontSize: 24,
    fontWeight: '600',
  },
  subtitle: {
    color: Colors.textMuted,
    fontSize: 15,
    fontWeight: '400',
    marginTop: 4,
    marginBottom: Spacing.lg,
  },
  notice: {
    color: Colors.primary,
    fontWeight: '400',
    marginBottom: Spacing.md,
  },
  loading: {
    padding: Spacing.xl,
    alignItems: 'center',
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  summaryCard: {
    width: '47%',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
  },
  summaryLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  summaryValue: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: '600',
    marginTop: 6,
  },
  section: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.lg,
  },
  sectionTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '600',
    marginBottom: Spacing.md,
  },
  emptyText: {
    color: Colors.textMuted,
    fontWeight: '400',
  },
  item: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.md,
    paddingVertical: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  itemInfo: {
    flex: 1,
  },
  itemTitle: {
    color: Colors.text,
    fontWeight: '600',
  },
  itemMeta: {
    color: Colors.textMuted,
    fontWeight: '400',
    marginTop: 4,
    lineHeight: 18,
  },
  itemValue: {
    color: Colors.primary,
    fontWeight: '600',
    textAlign: 'right',
    maxWidth: 130,
  },
});
