import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { ProductPicker } from '@/components/product-picker';
import { TextField } from '@/components/text-field';
import { Colors, Radius, Spacing } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useBranch } from '@/lib/branch-context';
import { formatDateTime, formatMoney } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import type { Layaway, Product } from '@/types/database';

export default function LayawaysScreen() {
  const { session } = useAuth();
  const { selectedBranch, selectedBranchId } = useBranch();
  const [products, setProducts] = useState<Product[]>([]);
  const [layaways, setLayaways] = useState<Layaway[]>([]);
  const [product, setProduct] = useState<Product | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [contact, setContact] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [deposit, setDeposit] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [note, setNote] = useState('');
  const [selectedLayaway, setSelectedLayaway] = useState<Layaway | null>(null);
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentNote, setPaymentNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('products').select('*').eq('branch_id', selectedBranchId).order('name');
      setProducts((data as Product[]) ?? []);
    })();
  }, [selectedBranchId]);

  useEffect(() => {
    if (product?.unit_price) setTotalAmount(String(product.unit_price));
  }, [product]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('layaways')
      .select('*, products(id,name,unit,sku)')
      .eq('branch_id', selectedBranchId)
      .order('created_at', { ascending: false })
      .limit(50);
    setLayaways((data as unknown as Layaway[]) ?? []);
  }, [selectedBranchId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const total = Number(totalAmount) || 0;
  const paid = Number(deposit) || 0;
  const balance = Math.max(total - paid, 0);
  const openPlans = layaways.filter((item) => item.status === 'open');
  const totalPlanBalance = openPlans.reduce((sum, item) => sum + Math.max(item.total_amount - item.amount_paid, 0), 0);
  const overduePlans = openPlans.filter((item) => item.due_date && new Date(`${item.due_date}T00:00:00`) < new Date());

  const onSubmit = async () => {
    if (!customerName.trim() || total <= 0) {
      setError('Jaza customer na total amount sahihi');
      return;
    }
    setError(null);
    setLoading(true);
    const { error: insertError } = await supabase.from('layaways').insert({
      branch_id: selectedBranchId,
      customer_name: customerName.trim(),
      customer_contact: contact.trim() || null,
      product_id: product?.id ?? null,
      total_amount: total,
      amount_paid: paid,
      status: balance <= 0 ? 'completed' : 'open',
      due_date: dueDate.trim() || null,
      note: note.trim() || null,
      created_by: session?.user.id,
    });
    setLoading(false);
    if (insertError) {
      setError(insertError.message.includes('layaways') ? 'Run SQL ya equipment sales modules kwanza.' : insertError.message);
      return;
    }
    setCustomerName('');
    setContact('');
    setProduct(null);
    setTotalAmount('');
    setDeposit('');
    setDueDate('');
    setNote('');
    await load();
  };

  const onPayment = async () => {
    const amount = Number(paymentAmount) || 0;
    if (!selectedLayaway || amount <= 0) {
      setError('Chagua layaway na weka amount sahihi');
      return;
    }
    const nextPaid = selectedLayaway.amount_paid + amount;
    const nextStatus = nextPaid >= selectedLayaway.total_amount ? 'completed' : 'open';

    setError(null);
    setLoading(true);
    const { error: paymentError } = await supabase.from('layaway_payments').insert({
      layaway_id: selectedLayaway.id,
      amount,
      note: paymentNote.trim() || null,
      created_by: session?.user.id,
    });

    if (paymentError) {
      setLoading(false);
      setError(paymentError.message);
      return;
    }

    const { error: updateError } = await supabase
      .from('layaways')
      .update({ amount_paid: nextPaid, status: nextStatus })
      .eq('id', selectedLayaway.id);

    setLoading(false);

    if (updateError) {
      setError(updateError.message);
      return;
    }

    setSelectedLayaway(null);
    setPaymentAmount('');
    setPaymentNote('');
    await load();
  };

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      <Text style={styles.branchHint}>Branch: {selectedBranch?.name}</Text>
      <View style={styles.summaryRow}>
        <SummaryBox label="Open plans" value={String(openPlans.length)} />
        <SummaryBox label="Balance" value={`Tsh ${formatMoney(totalPlanBalance)}`} />
        <SummaryBox label="Overdue" value={String(overduePlans.length)} danger={overduePlans.length > 0} />
      </View>
      <View style={styles.card}>
        <Text style={styles.title}>Customer Payment Plan</Text>
        <TextField label="Customer name *" value={customerName} onChangeText={setCustomerName} />
        <TextField label="Contact" value={contact} onChangeText={setContact} />
        <ProductPicker label="Bidhaa" products={products} value={product} onChange={setProduct} />
        <TextField label="Total amount *" value={totalAmount} onChangeText={setTotalAmount} keyboardType="numeric" />
        <TextField label="Deposit / paid" value={deposit} onChangeText={setDeposit} keyboardType="numeric" />
        <TextField label="Due date (YYYY-MM-DD)" value={dueDate} onChangeText={setDueDate} />
        <TextField label="Note" value={note} onChangeText={setNote} multiline />
        <Text style={styles.total}>Balance: Tsh {formatMoney(balance)}</Text>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button label="Save Layaway" onPress={onSubmit} loading={loading} />
      </View>

      <Text style={styles.sectionTitle}>Open Layaways</Text>
      {selectedLayaway ? (
        <View style={styles.card}>
          <Text style={styles.title}>Add Payment</Text>
          <Text style={styles.total}>
            {selectedLayaway.customer_name} balance: Tsh{' '}
            {formatMoney(Math.max(selectedLayaway.total_amount - selectedLayaway.amount_paid, 0))}
          </Text>
          <TextField label="Payment amount *" value={paymentAmount} onChangeText={setPaymentAmount} keyboardType="numeric" />
          <TextField label="Payment note" value={paymentNote} onChangeText={setPaymentNote} />
          <Button label="Save Payment" onPress={onPayment} loading={loading} />
        </View>
      ) : null}
      {layaways.length === 0 ? (
        <Text style={styles.empty}>Hakuna layaway bado.</Text>
      ) : (
        layaways.map((item) => (
          <LayawayRow key={item.id} item={item} onSelect={() => setSelectedLayaway(item)} />
        ))
      )}
    </ScrollView>
  );
}

function SummaryBox({ label, value, danger = false }: { label: string; value: string; danger?: boolean }) {
  return (
    <View style={styles.summaryBox}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, danger && styles.dangerText]}>{value}</Text>
    </View>
  );
}

function LayawayRow({ item, onSelect }: { item: Layaway; onSelect: () => void }) {
  const balance = Math.max(item.total_amount - item.amount_paid, 0);
  return (
    <Pressable style={styles.listCard} onPress={onSelect}>
      <View style={styles.listTop}>
        <Text style={styles.customer}>{item.customer_name}</Text>
        <Text style={styles.amount}>Tsh {formatMoney(balance)}</Text>
      </View>
      <Text style={styles.meta}>{item.products?.name ?? 'Item'} | Paid Tsh {formatMoney(item.amount_paid)} | {formatDateTime(item.created_at)}</Text>
      <Text style={styles.payHint}>Tap to add payment</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: 120 },
  branchHint: { color: Colors.primaryDark, fontWeight: '400', marginBottom: Spacing.lg },
  card: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, padding: Spacing.lg },
  summaryRow: { flexDirection: 'row', gap: Spacing.sm, marginBottom: Spacing.md },
  summaryBox: { flex: 1, backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, padding: Spacing.md },
  summaryLabel: { color: Colors.textMuted, fontSize: 11, fontWeight: '500' },
  summaryValue: { color: Colors.text, fontSize: 14, fontWeight: '600', marginTop: 2 },
  dangerText: { color: Colors.danger },
  title: { color: Colors.text, fontSize: 18, fontWeight: '600', marginBottom: Spacing.md },
  total: { color: Colors.primaryDark, fontSize: 16, fontWeight: '600', marginBottom: Spacing.md },
  error: { color: Colors.danger, textAlign: 'center', marginBottom: Spacing.md },
  sectionTitle: { color: Colors.text, fontSize: 17, fontWeight: '600', marginTop: Spacing.xl, marginBottom: Spacing.md },
  empty: { color: Colors.textMuted },
  listCard: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, padding: Spacing.md, marginBottom: Spacing.md },
  listTop: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
  customer: { flex: 1, color: Colors.text, fontWeight: '600' },
  amount: { color: Colors.warning, fontWeight: '600' },
  meta: { color: Colors.textMuted, marginTop: Spacing.xs },
  payHint: { color: Colors.primaryDark, fontWeight: '400', marginTop: Spacing.sm },
});
