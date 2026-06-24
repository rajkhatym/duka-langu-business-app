import { router } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { StatCard } from '@/components/stat-card';
import { TextField } from '@/components/text-field';
import { Colors, Spacing } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useBranch } from '@/lib/branch-context';
import { formatMoney } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import type { Expense, Sale } from '@/types/database';

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function startOfTodayIso() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date.toISOString();
}

function ClosingLine({
  label,
  expected,
  actual,
  difference,
  muted = false,
}: {
  label: string;
  expected: number;
  actual: number;
  difference: number;
  muted?: boolean;
}) {
  const cleanDifference = Math.abs(difference) < 0.01 ? 0 : difference;
  return (
    <View style={styles.closingLine}>
      <View style={styles.closingLineInfo}>
        <Text style={styles.closingLineLabel}>{label}</Text>
        <Text style={styles.closingLineMeta}>
          Expected Tsh {formatMoney(expected)}
          {muted ? '' : ` · Actual Tsh ${formatMoney(actual)}`}
        </Text>
      </View>
      <Text style={[styles.closingLineDiff, cleanDifference < 0 && styles.closingLineDiffDanger]}>
        Tsh {formatMoney(cleanDifference)}
      </Text>
    </View>
  );
}

export default function DailyClosingScreen() {
  const { isOwner, session } = useAuth();
  const { selectedBranch, selectedBranchId } = useBranch();
  const [sales, setSales] = useState<Sale[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [actualCash, setActualCash] = useState('');
  const [actualMpesa, setActualMpesa] = useState('');
  const [actualBank, setActualBank] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      const from = startOfTodayIso();
      let [salesRes, expensesRes] = await Promise.all([
        supabase
          .from('sales')
          .select('*, products(id,name,unit,sku,cost_price)')
          .eq('branch_id', selectedBranchId)
          .gte('created_at', from),
        supabase
          .from('expenses')
          .select('*')
          .eq('branch_id', selectedBranchId)
          .gte('created_at', from),
      ]);

      if (salesRes.error?.message.includes('branch_id')) {
        salesRes = await supabase.from('sales').select('*, products(id,name,unit,sku,cost_price)').gte('created_at', from);
      }
      if (expensesRes.error?.message.includes('branch_id')) {
        expensesRes = await supabase.from('expenses').select('*').gte('created_at', from);
      }

      if (!active) return;
      setSales((salesRes.data as unknown as Sale[]) ?? []);
      setExpenses((expensesRes.data as Expense[]) ?? []);
      setLoading(false);
    })();

    return () => {
      active = false;
    };
  }, [selectedBranchId]);

  const totals = useMemo(() => {
    const salesTotal = sales.reduce((sum, sale) => sum + sale.quantity * sale.unit_price, 0);
    const cashCollected = sales
      .filter((sale) => !sale.payment_method || sale.payment_method === 'cash')
      .reduce((sum, sale) => sum + sale.amount_paid, 0);
    const mpesaCollected = sales
      .filter((sale) => sale.payment_method === 'mpesa')
      .reduce((sum, sale) => sum + sale.amount_paid, 0);
    const bankCollected = sales
      .filter((sale) => sale.payment_method === 'bank')
      .reduce((sum, sale) => sum + sale.amount_paid, 0);
    const creditBalance = sales
      .filter((sale) => sale.payment_method === 'credit')
      .reduce((sum, sale) => sum + Math.max(sale.quantity * sale.unit_price - sale.amount_paid, 0), 0);
    const expensesTotal = expenses.reduce((sum, expense) => sum + expense.amount, 0);
    const costOfGoods = sales.reduce(
      (sum, sale) => sum + sale.quantity * (sale.products?.cost_price ?? 0),
      0
    );
    const expectedCash = cashCollected - expensesTotal;
    const expectedTotal = expectedCash + mpesaCollected + bankCollected;
    return {
      salesTotal,
      cashCollected,
      mpesaCollected,
      bankCollected,
      creditBalance,
      expensesTotal,
      costOfGoods,
      expectedCash,
      expectedTotal,
      profit: salesTotal - costOfGoods - expensesTotal,
    };
  }, [expenses, sales]);

  const actualCashValue = Number(actualCash) || 0;
  const actualMpesaValue = Number(actualMpesa) || 0;
  const actualBankValue = Number(actualBank) || 0;
  const actualTotal = actualCashValue + actualMpesaValue + actualBankValue;
  const cashDifference = actualCashValue - totals.expectedCash;
  const mpesaDifference = actualMpesaValue - totals.mpesaCollected;
  const bankDifference = actualBankValue - totals.bankCollected;
  const difference = actualTotal - totals.expectedTotal;

  const onSubmit = async () => {
    const actual = Number(actualCash);
    const actualMobile = Number(actualMpesa);
    const actualBankAmount = Number(actualBank);
    if (
      Number.isNaN(actual) ||
      Number.isNaN(actualMobile) ||
      Number.isNaN(actualBankAmount) ||
      actual < 0 ||
      actualMobile < 0 ||
      actualBankAmount < 0
    ) {
      setError('Weka hesabu halisi sahihi kwa Cash, M-Pesa na Bank');
      return;
    }

    setError(null);
    setSaving(true);
    const breakdownNote = [
      `Payment breakdown: Cash expected Tsh ${formatMoney(totals.expectedCash)}, actual Tsh ${formatMoney(actual)}.`,
      `M-Pesa expected Tsh ${formatMoney(totals.mpesaCollected)}, actual Tsh ${formatMoney(actualMobile)}.`,
      `Bank expected Tsh ${formatMoney(totals.bankCollected)}, actual Tsh ${formatMoney(actualBankAmount)}.`,
      `Credit balance Tsh ${formatMoney(totals.creditBalance)}.`,
      note.trim() ? `Note: ${note.trim()}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    const { error: insertError } = await supabase.from('daily_closings').insert({
      branch_id: selectedBranchId,
      closing_date: todayIsoDate(),
      expected_cash: totals.expectedTotal,
      actual_cash: actual + actualMobile + actualBankAmount,
      note: breakdownNote,
      created_by: session?.user.id,
    });

    setSaving(false);

    if (insertError) {
      if (insertError.message.includes('daily_closings')) {
        setError('Run SQL ya daily_closings kwenye Supabase kwanza.');
        return;
      }
      if (insertError.message.includes('duplicate')) {
        setError('Daily closing ya leo kwa branch hii tayari imehifadhiwa.');
        return;
      }
      setError(insertError.message);
      return;
    }

    router.back();
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.branchHint}>Branch: {selectedBranch?.name}</Text>

        <View style={styles.statsRow}>
          <StatCard label="Mauzo Leo" value={`Tsh ${formatMoney(totals.salesTotal)}`} />
          <StatCard label="Malipo Yote" value={`Tsh ${formatMoney(totals.cashCollected + totals.mpesaCollected + totals.bankCollected)}`} />
        </View>
        <View style={styles.statsRow}>
          <StatCard label="Matumizi Leo" value={`Tsh ${formatMoney(totals.expensesTotal)}`} tone="danger" />
          {isOwner ? (
            <StatCard label="Profit Leo" value={`Tsh ${formatMoney(totals.profit)}`} tone={totals.profit < 0 ? 'danger' : 'success'} />
          ) : null}
        </View>
        <View style={styles.statsRow}>
          <StatCard label="Closing Total" value={`Tsh ${formatMoney(totals.expectedTotal)}`} />
          <StatCard label="Tofauti" value={`Tsh ${formatMoney(difference)}`} tone={difference < 0 ? 'danger' : 'success'} />
        </View>

        <View style={styles.breakdownPanel}>
          <Text style={styles.panelTitle}>Payment Method Closing</Text>
          <ClosingLine label="Cash expected" expected={totals.expectedCash} actual={actualCashValue} difference={cashDifference} />
          <ClosingLine label="M-Pesa expected" expected={totals.mpesaCollected} actual={actualMpesaValue} difference={mpesaDifference} />
          <ClosingLine label="Bank expected" expected={totals.bankCollected} actual={actualBankValue} difference={bankDifference} />
          <ClosingLine label="Credit balance" expected={totals.creditBalance} actual={0} difference={-totals.creditBalance} muted />
        </View>

        <TextField
          label="Cash halisi dukani *"
          value={actualCash}
          onChangeText={setActualCash}
          keyboardType="numeric"
          placeholder="Mfano: 450000"
          editable={!loading}
        />
        <TextField
          label="M-Pesa halisi *"
          value={actualMpesa}
          onChangeText={setActualMpesa}
          keyboardType="numeric"
          placeholder="Mfano: 250000"
          editable={!loading}
        />
        <TextField
          label="Bank halisi *"
          value={actualBank}
          onChangeText={setActualBank}
          keyboardType="numeric"
          placeholder="Mfano: 100000"
          editable={!loading}
        />
        <TextField
          label="Maelezo (hiari)"
          value={note}
          onChangeText={setNote}
          placeholder="Mfano: Cash imepungua kwa sababu..."
          multiline
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button label="Hifadhi Daily Closing" onPress={onSubmit} loading={saving || loading} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  content: {
    padding: Spacing.lg,
    paddingBottom: 120,
  },
  branchHint: {
    color: Colors.primaryDark,
    fontWeight: '400',
    marginBottom: Spacing.lg,
  },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginBottom: Spacing.md,
  },
  breakdownPanel: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 14,
    padding: Spacing.md,
    gap: Spacing.sm,
    marginBottom: Spacing.md,
  },
  panelTitle: {
    color: Colors.text,
    fontSize: 16,
    fontWeight: '600',
  },
  closingLine: {
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.sm,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  closingLineInfo: {
    flex: 1,
  },
  closingLineLabel: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '500',
  },
  closingLineMeta: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
  closingLineDiff: {
    color: Colors.primaryDark,
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'right',
  },
  closingLineDiffDanger: {
    color: Colors.danger,
  },
  error: {
    color: Colors.danger,
    marginBottom: Spacing.lg,
    textAlign: 'center',
  },
});
