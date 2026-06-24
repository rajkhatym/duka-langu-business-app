import { router } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text } from 'react-native';

import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { Colors, Spacing } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useBranch } from '@/lib/branch-context';
import { supabase } from '@/lib/supabase';

export default function OperationCashScreen() {
  const { isOwner, session } = useAuth();
  const { selectedBranch, selectedBranchId } = useBranch();
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async () => {
    const value = Number(amount);
    if (!isOwner) {
      setError('Ni owner pekee anayeweza kuongeza operation cash.');
      return;
    }
    if (!value || value <= 0) {
      setError('Weka kiasi sahihi cha operation cash.');
      return;
    }

    setError(null);
    setLoading(true);
    const { error: insertError } = await supabase.from('operation_cash_injections').insert({
      branch_id: selectedBranchId,
      amount: value,
      note: note.trim() || null,
      injected_by: session?.user.id ?? null,
    });
    setLoading(false);

    if (insertError) {
      setError(
        insertError.message.includes('operation_cash_injections')
          ? 'Run SQL ya Operation Cash kwanza ili kipengele hiki kifanye kazi.'
          : insertError.message
      );
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
        <Text style={styles.help}>
          Hii ni pesa ambayo owner anaweka kwa ajili ya kuendesha shughuli za branch. Matumizi yakirekodiwa, balance ya operation cash inapungua.
        </Text>
        <TextField label="Kiasi cha cash *" value={amount} onChangeText={setAmount} keyboardType="numeric" placeholder="Tsh" />
        <TextField label="Maelezo" value={note} onChangeText={setNote} multiline placeholder="Mfano: Float ya wiki hii" />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button label="Ongeza Operation Cash" onPress={onSubmit} loading={loading} />
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
    marginBottom: Spacing.md,
  },
  help: {
    color: Colors.textMuted,
    fontWeight: '400',
    lineHeight: 20,
    marginBottom: Spacing.lg,
  },
  error: {
    color: Colors.danger,
    marginBottom: Spacing.lg,
    textAlign: 'center',
  },
});
