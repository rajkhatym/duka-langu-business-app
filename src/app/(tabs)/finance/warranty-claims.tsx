import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { ProductPicker } from '@/components/product-picker';
import { TextField } from '@/components/text-field';
import { Colors, Radius, Spacing } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useBranch } from '@/lib/branch-context';
import { formatDateTime } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import type { Product, WarrantyClaim } from '@/types/database';

export default function WarrantyClaimsScreen() {
  const { productId: prefillProductId } = useLocalSearchParams<{ productId?: string }>();
  const { session } = useAuth();
  const { selectedBranch, selectedBranchId } = useBranch();
  const [products, setProducts] = useState<Product[]>([]);
  const [claims, setClaims] = useState<WarrantyClaim[]>([]);
  const [product, setProduct] = useState<Product | null>(null);
  const [customerName, setCustomerName] = useState('');
  const [issue, setIssue] = useState('');
  const [action, setAction] = useState<'review' | 'repair' | 'exchange' | 'refund' | 'reject'>('review');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('products').select('*').eq('branch_id', selectedBranchId).order('name');
      setProducts((data as Product[]) ?? []);
    })();
  }, [selectedBranchId]);

  useEffect(() => {
    if (!prefillProductId || products.length === 0) return;
    const matchedProduct = products.find((nextProduct) => nextProduct.id === prefillProductId);
    if (matchedProduct) setProduct(matchedProduct);
  }, [prefillProductId, products]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('warranty_claims')
      .select('*, products(id,name,unit,sku)')
      .eq('branch_id', selectedBranchId)
      .order('created_at', { ascending: false })
      .limit(50);
    setClaims((data as unknown as WarrantyClaim[]) ?? []);
  }, [selectedBranchId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const onSubmit = async () => {
    if (!customerName.trim() || !issue.trim()) {
      setError('Jaza customer na issue');
      return;
    }
    setError(null);
    setLoading(true);
    const { error: insertError } = await supabase.from('warranty_claims').insert({
      branch_id: selectedBranchId,
      product_id: product?.id ?? null,
      customer_name: customerName.trim(),
      issue: issue.trim(),
      action,
      status: 'pending',
      created_by: session?.user.id,
    });
    setLoading(false);
    if (insertError) {
      setError(insertError.message.includes('warranty_claims') ? 'Run SQL ya equipment sales modules kwanza.' : insertError.message);
      return;
    }
    setProduct(null);
    setCustomerName('');
    setIssue('');
    setAction('review');
    await load();
  };

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      <Text style={styles.branchHint}>Branch: {selectedBranch?.name}</Text>
      <View style={styles.card}>
        <Text style={styles.title}>New Warranty Claim / Return</Text>
        <TextField label="Customer name *" value={customerName} onChangeText={setCustomerName} />
        <ProductPicker label="Bidhaa" products={products} value={product} onChange={setProduct} />
        <TextField label="Issue / Sababu *" value={issue} onChangeText={setIssue} multiline />
        <View style={styles.actions}>
          {(['review', 'repair', 'exchange', 'refund', 'reject'] as const).map((item) => (
            <Text
              key={item}
              onPress={() => setAction(item)}
              style={[styles.actionChip, action === item && styles.actionChipActive]}>
              {item}
            </Text>
          ))}
        </View>
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button label="Save Claim" onPress={onSubmit} loading={loading} />
      </View>

      <Text style={styles.sectionTitle}>Recent Claims</Text>
      {claims.length === 0 ? <Text style={styles.empty}>Hakuna warranty claims bado.</Text> : claims.map((claim) => <ClaimRow key={claim.id} claim={claim} />)}
    </ScrollView>
  );
}

function ClaimRow({ claim }: { claim: WarrantyClaim }) {
  return (
    <View style={styles.listCard}>
      <View style={styles.listTop}>
        <Text style={styles.customer}>{claim.customer_name}</Text>
        <Text style={styles.status}>{claim.status}</Text>
      </View>
      <Text style={styles.meta}>{claim.products?.name ?? 'Item'} | {claim.action} | {formatDateTime(claim.created_at)}</Text>
      <Text style={styles.issue}>{claim.issue}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: 120 },
  branchHint: { color: Colors.primaryDark, fontWeight: '400', marginBottom: Spacing.lg },
  card: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, padding: Spacing.lg },
  title: { color: Colors.text, fontSize: 18, fontWeight: '600', marginBottom: Spacing.md },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.md },
  actionChip: { borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.pill, color: Colors.textMuted, fontWeight: '600', overflow: 'hidden', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm },
  actionChipActive: { backgroundColor: Colors.primary, borderColor: Colors.primary, color: Colors.white },
  error: { color: Colors.danger, textAlign: 'center', marginBottom: Spacing.md },
  sectionTitle: { color: Colors.text, fontSize: 17, fontWeight: '600', marginTop: Spacing.xl, marginBottom: Spacing.md },
  empty: { color: Colors.textMuted },
  listCard: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, padding: Spacing.md, marginBottom: Spacing.md },
  listTop: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
  customer: { flex: 1, color: Colors.text, fontWeight: '600' },
  status: { color: Colors.warning, fontWeight: '600' },
  meta: { color: Colors.textMuted, marginTop: Spacing.xs },
  issue: { color: Colors.text, marginTop: Spacing.xs, fontWeight: '400' },
});
