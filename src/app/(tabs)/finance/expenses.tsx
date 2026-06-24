import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Linking, Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';
import { Colors, Radius, Spacing } from '@/constants/colors';
import { isAnyPreviewMode } from '@/lib/auth-context';
import { useBranch } from '@/lib/branch-context';
import { formatDateTime, formatMoney } from '@/lib/format';
import { getPreviewData } from '@/lib/preview-data';
import { supabase } from '@/lib/supabase';
import type { Expense } from '@/types/database';

type ExpenseFilter = 'today' | 'month' | 'all';
type ReceiptFilter = 'all' | 'attached' | 'missing';

function hasReceipt(expense: Expense) {
  return Boolean(expense.receipt_storage_path || expense.receipt_data_url || expense.receipt_file_name);
}

function getFilterStart(filter: ExpenseFilter) {
  if (filter === 'all') return null;
  const date = new Date();
  if (filter === 'today') {
    date.setHours(0, 0, 0, 0);
    return date;
  }
  date.setDate(date.getDate() - 30);
  return date;
}

async function openUrl(url: string) {
  if (Platform.OS === 'web' && typeof window !== 'undefined') {
    const opened = window.open(url, '_blank', 'noopener,noreferrer');
    if (!opened) window.location.href = url;
    return;
  }
  await Linking.openURL(url);
}

async function openExpenseReceipt(expense: Expense) {
  if (expense.receipt_storage_path?.startsWith('preview/')) {
    Alert.alert(
      'Demo receipt',
      `${expense.receipt_file_name ?? expense.receipt_storage_path} imewekwa kwenye record. Kwenye data halisi, attachment itafunguka hapa.`
    );
    return;
  }

  if (expense.receipt_storage_path) {
    const pendingWindow =
      Platform.OS === 'web' && typeof window !== 'undefined'
        ? window.open('', '_blank', 'noopener,noreferrer')
        : null;
    if (pendingWindow) {
      pendingWindow.document.write('<p style="font-family: system-ui; padding: 24px;">Inafungua risiti/document...</p>');
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
    Alert.alert('Risiti haijafunguka', error?.message ?? 'Imeshindikana kufungua receipt/document kutoka Storage.');
    return;
  }

  if (expense.receipt_data_url) {
    await openUrl(expense.receipt_data_url);
    return;
  }

  if (expense.receipt_file_name) {
    Alert.alert('Risiti / Document', `${expense.receipt_file_name} imeandikwa kwenye record, lakini file halisi halijapatikana.`);
    return;
  }

  Alert.alert('Risiti / Document', 'Matumizi haya hayana receipt/document attachment.');
}

export default function ExpensesScreen() {
  const { selectedBranch, selectedBranchId } = useBranch();
  const previewMode = isAnyPreviewMode();
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [filter, setFilter] = useState<ExpenseFilter>('all');
  const [receiptFilter, setReceiptFilter] = useState<ReceiptFilter>('all');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setNotice(null);
    let response = await supabase
      .from('expenses')
      .select('*')
      .eq('branch_id', selectedBranchId)
      .order('created_at', { ascending: false })
      .limit(500);

    if (response.error?.message.includes('branch_id')) {
      response = await supabase
        .from('expenses')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(500);
    }

    let nextExpenses = response.error ? [] : ((response.data as unknown as Expense[]) ?? []);

    if (previewMode && nextExpenses.length === 0) {
      nextExpenses = getPreviewData(selectedBranchId).expenses;
    } else if (response.error) {
      setNotice(`Matumizi hayajapakuliwa: ${response.error.message}`);
    }

    setExpenses(nextExpenses);
  }, [previewMode, selectedBranchId]);

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

  const periodExpenses = useMemo(() => {
    const start = getFilterStart(filter);
    if (!start) return expenses;
    return expenses.filter((expense) => new Date(expense.created_at) >= start);
  }, [expenses, filter]);

  const visibleExpenses = useMemo(() => {
    if (receiptFilter === 'attached') return periodExpenses.filter(hasReceipt);
    if (receiptFilter === 'missing') return periodExpenses.filter((expense) => !hasReceipt(expense));
    return periodExpenses;
  }, [periodExpenses, receiptFilter]);

  const total = visibleExpenses.reduce((sum, expense) => sum + expense.amount, 0);
  const missingReceipts = periodExpenses.filter((expense) => !hasReceipt(expense)).length;
  const attachedReceipts = periodExpenses.length - missingReceipts;
  const emptyTitle =
    receiptFilter === 'attached'
      ? 'Hakuna matumizi yenye risiti'
      : receiptFilter === 'missing'
        ? 'Hakuna matumizi bila risiti'
        : 'Hakuna matumizi';

  return (
    <Screen>
      <FlatList
        data={loading ? [] : visibleExpenses}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        refreshing={refreshing}
        onRefresh={onRefresh}
        renderItem={({ item }) => <ExpenseRow expense={item} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <View style={styles.topActions}>
              <Pressable
                style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed]}
                onPress={() => router.push('/(tabs)/finance/new-expense' as Href)}>
                <Text style={styles.primaryButtonText}>+ Matumizi</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.secondaryButton, pressed && styles.pressed]}
                onPress={() => router.push('/(tabs)/finance' as Href)}>
                <Text style={styles.secondaryButtonText}>Finance</Text>
              </Pressable>
            </View>

            <View style={styles.branchPanel}>
              <Text style={styles.branchTitle}>Matumizi yote</Text>
              <Text style={styles.branchSubtitle}>
                {selectedBranch?.name ?? selectedBranchId} · list ya matumizi yaliyoingizwa kwenye branch hii
              </Text>
            </View>

            <View style={styles.filterSwitch}>
              <FilterButton label="Leo" active={filter === 'today'} onPress={() => setFilter('today')} />
              <FilterButton label="Siku 30" active={filter === 'month'} onPress={() => setFilter('month')} />
              <FilterButton label="Zote" active={filter === 'all'} onPress={() => setFilter('all')} />
            </View>

            {notice ? <Text style={styles.notice}>{notice}</Text> : null}

            <View style={styles.summaryGrid}>
              <CompactMetric label="Jumla" value={`Tsh ${formatMoney(total)}`} tone="danger" />
              <CompactMetric
                label="Record"
                value={String(periodExpenses.length)}
                active={receiptFilter === 'all'}
                testID="expense-filter-all"
                onPress={() => setReceiptFilter('all')}
              />
              <CompactMetric
                label="Risiti zipo"
                value={String(attachedReceipts)}
                tone="success"
                active={receiptFilter === 'attached'}
                testID="expense-filter-attached"
                onPress={() => setReceiptFilter('attached')}
              />
              <CompactMetric
                label="Bila risiti"
                value={String(missingReceipts)}
                tone={missingReceipts > 0 ? 'warning' : 'success'}
                active={receiptFilter === 'missing'}
                testID="expense-filter-missing"
                onPress={() => setReceiptFilter('missing')}
              />
            </View>
          </View>
        }
        ListEmptyComponent={
          loading ? (
            <View style={styles.loading}>
              <ActivityIndicator size="large" color={Colors.primary} />
            </View>
          ) : (
            <EmptyState title={emptyTitle} subtitle="Bonyeza Record kuona zote au badilisha kipindi uone data nyingine." />
          )
        }
      />
    </Screen>
  );
}

function FilterButton({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <Pressable style={[styles.filterButton, active && styles.filterButtonActive]} onPress={onPress}>
      <Text style={[styles.filterText, active && styles.filterTextActive]}>{label}</Text>
    </Pressable>
  );
}

function CompactMetric({
  label,
  value,
  tone = 'default',
  active = false,
  testID,
  onPress,
}: {
  label: string;
  value: string;
  tone?: 'default' | 'danger' | 'success' | 'warning';
  active?: boolean;
  testID?: string;
  onPress?: () => void;
}) {
  return (
    <Pressable
      disabled={!onPress}
      testID={testID}
      style={({ pressed }) => [
        styles.compactMetric,
        tone === 'danger' && styles.compactMetricDanger,
        tone === 'success' && styles.compactMetricSuccess,
        tone === 'warning' && styles.compactMetricWarning,
        active && styles.compactMetricActive,
        pressed && styles.pressed,
      ]}
      onPress={onPress}>
      <Text style={[styles.compactMetricValue, tone === 'danger' && styles.dangerText, tone === 'success' && styles.successText, tone === 'warning' && styles.warningText]}>
        {value}
      </Text>
      <Text style={styles.compactMetricLabel}>{label}</Text>
    </Pressable>
  );
}

function ExpenseRow({ expense }: { expense: Expense }) {
  const [expanded, setExpanded] = useState(false);
  const [receiptMessage, setReceiptMessage] = useState<string | null>(null);
  const receiptAttached = hasReceipt(expense);
  const actor = expense.profiles?.full_name ?? expense.created_by?.slice(0, 8) ?? 'System';
  const receiptLabel = expense.receipt_file_name ?? expense.receipt_storage_path ?? 'Attachment';

  const showReceipt = async () => {
    setReceiptMessage(null);
    if (expense.receipt_storage_path?.startsWith('preview/') || (!expense.receipt_storage_path && !expense.receipt_data_url)) {
      setReceiptMessage(`Kilichowekwa: ${receiptLabel}`);
      return;
    }
    setReceiptMessage(`Inafungua: ${receiptLabel}`);
    await openExpenseReceipt(expense);
  };

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        style={({ pressed }) => [styles.rowSummary, pressed && styles.pressed]}
        onPress={() => setExpanded((current) => !current)}>
        <View style={styles.rowTop}>
          <Text style={styles.title}>{expense.title}</Text>
          <Text style={styles.amount}>Tsh {formatMoney(expense.amount)}</Text>
        </View>
        <View style={styles.metaRow}>
          <Text style={styles.category}>
            {expense.category ?? 'Matumizi'} · {formatDateTime(expense.created_at)}
          </Text>
          <Text style={[styles.receiptBadge, !receiptAttached && styles.receiptMissingBadge]}>
            {receiptAttached ? 'Risiti ipo' : 'Bila risiti'}
          </Text>
        </View>
      </Pressable>
      {expanded ? (
        <>
          {expense.note ? <Text style={styles.note}>{expense.note}</Text> : null}
          <View style={styles.footer}>
            <Text style={styles.date}>Aliweka: {actor}</Text>
            {receiptAttached ? (
              <Pressable
                testID={`expense-receipt-${expense.id}`}
                style={({ pressed }) => [styles.attachmentButton, pressed && styles.pressed]}
                onPress={showReceipt}>
                <Text style={styles.attachmentButtonText}>
                  Fungua risiti/document{expense.receipt_file_name ? ` · ${expense.receipt_file_name}` : ''}
                </Text>
              </Pressable>
            ) : (
              <Text style={styles.actor}>Hakuna receipt/document attachment</Text>
            )}
            {receiptMessage ? <Text style={styles.receiptPreviewText}>{receiptMessage}</Text> : null}
          </View>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    paddingTop: Spacing.md,
    paddingBottom: Spacing.xxl,
    gap: Spacing.sm,
  },
  header: {
    gap: Spacing.sm,
  },
  topActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  primaryButton: {
    flex: 1,
    minHeight: 46,
    borderRadius: Radius.md,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  primaryButtonText: {
    color: Colors.white,
    fontSize: 14,
    fontWeight: '600',
  },
  secondaryButton: {
    minHeight: 46,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.primary,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
  },
  secondaryButtonText: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '600',
  },
  branchPanel: {
    borderWidth: 1,
    borderColor: '#F4C7C7',
    borderRadius: Radius.md,
    backgroundColor: '#FFF5F5',
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: 3,
  },
  branchTitle: {
    color: Colors.danger,
    fontSize: 17,
    fontWeight: '600',
  },
  branchSubtitle: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 17,
  },
  filterSwitch: {
    flexDirection: 'row',
    backgroundColor: Colors.primarySoft,
    borderRadius: Radius.md,
    padding: 4,
    gap: 4,
  },
  filterButton: {
    flex: 1,
    minHeight: 38,
    borderRadius: Radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
  },
  filterButtonActive: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.primary,
  },
  filterText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
  },
  filterTextActive: {
    color: Colors.primaryDark,
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
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  compactMetric: {
    flexGrow: 1,
    minWidth: '47%',
    minHeight: 54,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.sm,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.sm,
    paddingVertical: Spacing.sm,
    justifyContent: 'center',
  },
  compactMetricDanger: {
    borderColor: '#F4C7C7',
    backgroundColor: '#FFF5F5',
  },
  compactMetricSuccess: {
    borderColor: '#BFE5D6',
    backgroundColor: Colors.primarySoft,
  },
  compactMetricWarning: {
    borderColor: '#F6D89B',
    backgroundColor: Colors.warningSoft,
  },
  compactMetricActive: {
    borderColor: Colors.primary,
    borderWidth: 2,
  },
  compactMetricValue: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  compactMetricLabel: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '500',
    marginTop: 1,
  },
  row: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    gap: Spacing.xs,
  },
  rowSummary: {
    gap: Spacing.xs,
  },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  title: {
    flex: 1,
    color: Colors.text,
    fontSize: 15,
    fontWeight: '600',
  },
  amount: {
    color: Colors.danger,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'right',
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.sm,
  },
  category: {
    flex: 1,
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
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
    backgroundColor: Colors.warningSoft,
    color: Colors.warning,
  },
  note: {
    color: Colors.text,
    fontSize: 12,
    fontWeight: '400',
    lineHeight: 17,
  },
  footer: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.sm,
    gap: Spacing.sm,
  },
  date: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  actor: {
    color: Colors.textMuted,
    fontSize: 11,
    fontWeight: '400',
  },
  attachmentButton: {
    alignSelf: 'flex-start',
    borderRadius: Radius.sm,
    backgroundColor: Colors.primarySoft,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  attachmentButtonText: {
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '600',
  },
  receiptPreviewText: {
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '500',
  },
  pressed: {
    opacity: 0.76,
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
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: Spacing.xxl,
  },
});
