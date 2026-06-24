import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';

import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { Colors, Spacing } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useBranch } from '@/lib/branch-context';
import { supabase } from '@/lib/supabase';
import type { DebtStatus } from '@/types/database';

function statusForDebt(amount: number, paid: number): DebtStatus {
  if (paid >= amount) return 'paid';
  if (paid > 0) return 'partial';
  return 'open';
}

export default function NewDebtScreen() {
  const { session } = useAuth();
  const { selectedBranch, selectedBranchId } = useBranch();
  const [customerName, setCustomerName] = useState('');
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [amountPaid, setAmountPaid] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    const value = Number(amount);
    const paid = Number(amountPaid) || 0;

    if (!customerName.trim() || !value || value <= 0) {
      setError('Tafadhali jaza jina la mteja na kiasi sahihi');
      return;
    }
    if (paid > value) {
      setError('Kiasi kilicholipwa hakiwezi kuzidi deni');
      return;
    }

    setError(null);
    setLoading(true);

    const debtPayload = {
      branch_id: selectedBranchId,
      customer_name: customerName.trim(),
      description: description.trim() || null,
      amount: value,
      amount_paid: paid,
      due_date: dueDate.trim() || null,
      status: statusForDebt(value, paid),
      created_by: session?.user.id,
    };

    let { error: insertError } = await supabase.from('debts').insert(debtPayload);

    if (insertError?.message.includes('branch_id')) {
      const { branch_id: _branchId, ...fallbackPayload } = debtPayload;
      const fallback = await supabase.from('debts').insert(fallbackPayload);
      insertError = fallback.error;
    }

    setLoading(false);

    if (insertError) {
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
        <TextField label="Jina la mteja *" value={customerName} onChangeText={setCustomerName} />
        <TextField label="Maelezo" value={description} onChangeText={setDescription} placeholder="Alichukua nini?" />
        <TextField label="Kiasi cha deni *" value={amount} onChangeText={setAmount} keyboardType="numeric" />
        <TextField label="Imelipwa" value={amountPaid} onChangeText={setAmountPaid} keyboardType="numeric" />
        <TextField label="Tarehe ya kulipa (YYYY-MM-DD)" value={dueDate} onChangeText={setDueDate} />

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button label="Hifadhi Deni" onPress={onSubmit} loading={loading} />
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
  error: {
    color: Colors.danger,
    marginBottom: Spacing.lg,
    textAlign: 'center',
  },
  branchHint: {
    color: Colors.primaryDark,
    fontWeight: '400',
    marginBottom: Spacing.md,
  },
});
