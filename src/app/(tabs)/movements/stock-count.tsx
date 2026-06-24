import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { ProductPicker } from '@/components/product-picker';
import { TextField } from '@/components/text-field';
import { Colors, Spacing } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useBranch } from '@/lib/branch-context';
import { formatQuantity } from '@/lib/format';
import { applyLocalProductOverrides } from '@/lib/local-product-overrides';
import { supabase } from '@/lib/supabase';
import type { Product } from '@/types/database';

export default function StockCountScreen() {
  const { productId } = useLocalSearchParams<{ productId?: string }>();
  const { session } = useAuth();
  const { selectedBranch, selectedBranchId } = useBranch();
  const [products, setProducts] = useState<Product[]>([]);
  const [product, setProduct] = useState<Product | null>(null);
  const [countedQuantity, setCountedQuantity] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      let { data, error: productsError } = await supabase
        .from('products')
        .select('*')
        .eq('branch_id', selectedBranchId)
        .order('name');
      if (productsError?.message.includes('branch_id')) {
        const fallback = await supabase.from('products').select('*').order('name');
        data = fallback.data;
      }
      const nextProducts = applyLocalProductOverrides((data as Product[]) ?? []);
      setProducts(nextProducts);
      if (productId) {
        setProduct(nextProducts.find((nextProduct) => nextProduct.id === productId) ?? null);
      }
    })();
  }, [productId, selectedBranchId]);

  const counted = Number(countedQuantity);
  const systemQuantity = product?.quantity ?? 0;
  const difference = product && !Number.isNaN(counted) ? counted - systemQuantity : 0;

  const onSubmit = async () => {
    if (!product) {
      setError('Chagua bidhaa');
      return;
    }
    if (Number.isNaN(counted) || counted < 0) {
      setError('Weka stock count sahihi');
      return;
    }

    setError(null);
    setLoading(true);

    const { error: countError } = await supabase.from('stock_counts').insert({
      branch_id: selectedBranchId,
      product_id: product.id,
      system_quantity: systemQuantity,
      counted_quantity: counted,
      note: note.trim() || null,
      counted_by: session?.user.id,
    });

    if (countError) {
      setLoading(false);
      setError(countError.message.includes('stock_counts') ? 'Run SQL ya stock_counts kwanza.' : countError.message);
      return;
    }

    if (difference !== 0) {
      const { error: requestError } = await supabase.from('stock_adjustment_requests').insert({
        branch_id: selectedBranchId,
        product_id: product.id,
        requested_quantity: difference,
        reason: note.trim() || `Stock count difference: ${formatQuantity(difference)}`,
        requested_by: session?.user.id,
      });

      if (requestError) {
        setLoading(false);
        setError(
          requestError.message.includes('stock_adjustment_requests')
            ? 'Run SQL ya stock_adjustment_requests kwanza.'
            : requestError.message
        );
        return;
      }
    }

    setLoading(false);
    router.back();
  };

  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.branchHint}>Branch: {selectedBranch?.name}</Text>
        <ProductPicker label="Bidhaa *" products={products} value={product} onChange={setProduct} />
        {product ? (
          <View style={styles.systemBox}>
            <Text style={styles.systemText}>
              Mfumo unasema: {formatQuantity(product.quantity)} {product.unit}
            </Text>
            <Text style={[styles.diffText, difference < 0 && styles.dangerText]}>
              Difference: {formatQuantity(difference)} {product.unit}
            </Text>
          </View>
        ) : null}
        <TextField
          label="Stock uliyohesabu *"
          value={countedQuantity}
          onChangeText={setCountedQuantity}
          keyboardType="numeric"
        />
        <TextField
          label="Sababu / note"
          value={note}
          onChangeText={setNote}
          placeholder="Mfano: count ya mwisho wa mwezi"
          multiline
        />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button label="Hifadhi Count" onPress={onSubmit} loading={loading} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: 120 },
  branchHint: { color: Colors.primaryDark, fontWeight: '400', marginBottom: Spacing.lg },
  systemBox: {
    backgroundColor: Colors.primarySoft,
    borderRadius: 8,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    gap: Spacing.xs,
  },
  systemText: { color: Colors.text, fontWeight: '400' },
  diffText: { color: Colors.success, fontWeight: '400' },
  dangerText: { color: Colors.danger },
  error: { color: Colors.danger, marginBottom: Spacing.lg, textAlign: 'center' },
});
