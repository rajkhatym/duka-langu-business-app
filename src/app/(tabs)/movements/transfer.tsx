import { router, useLocalSearchParams, type Href } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { ProductPicker } from '@/components/product-picker';
import { TextField } from '@/components/text-field';
import { Colors, Radius, Spacing } from '@/constants/colors';
import { isAnyPreviewMode, isManagerPreviewMode, isOwnerPreviewMode, useAuth } from '@/lib/auth-context';
import { defaultBranches, useBranch } from '@/lib/branch-context';
import { applyLocalProductOverrides, saveLocalProductOverride } from '@/lib/local-product-overrides';
import { recordLocalStockMovement } from '@/lib/local-stock-movements';
import { setupDemoProducts } from '@/lib/setup-wizard';
import { supabase } from '@/lib/supabase';
import type { Branch, Product } from '@/types/database';

function previewProducts(branchId: string): Product[] {
  return setupDemoProducts.map((product, index) => ({
    id: `preview-product-${index + 1}`,
    branch_id: branchId,
    name: product.name,
    sku: product.sku,
    unit: product.unit,
    category: product.category ?? null,
    variant_size: null,
    variant_color: null,
    variant_weight: null,
    warranty_months: product.warranty_months ?? null,
    quantity: product.quantity,
    reorder_level: product.reorder_level,
    cost_price: product.cost_price ?? null,
    unit_price: product.unit_price ?? null,
    created_by: null,
    created_at: new Date().toISOString(),
  }));
}

export default function TransferStockScreen() {
  const { productId } = useLocalSearchParams<{ productId?: string }>();
  const { isAdmin, session } = useAuth();
  const { branches, selectedBranchId, selectedBranch } = useBranch();
  const [transferBranches, setTransferBranches] = useState<Branch[]>(defaultBranches);
  const [products, setProducts] = useState<Product[]>([]);
  const [product, setProduct] = useState<Product | null>(null);
  const [toBranchId, setToBranchId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const previewQuery = isOwnerPreviewMode() ? '?owner=preview' : isManagerPreviewMode() ? '?manager=preview' : '';

  const destinationBranches = useMemo(
    () => transferBranches.filter((branch) => branch.id !== selectedBranchId),
    [transferBranches, selectedBranchId]
  );

  useEffect(() => {
    setTransferBranches((current) => {
      const merged = [...current];
      branches.forEach((branch) => {
        if (!merged.some((existing) => existing.id === branch.id)) merged.push(branch);
      });
      return merged;
    });
    (async () => {
      const { data } = await supabase.from('branches').select('*').order('created_at');
      if (data?.length) setTransferBranches(data as Branch[]);
    })();
  }, [branches]);

  useEffect(() => {
    setToBranchId(destinationBranches[0]?.id ?? '');
  }, [destinationBranches]);

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
      const databaseProducts = applyLocalProductOverrides((data as Product[]) ?? []);
      const nextProducts =
        databaseProducts.length > 0 || !isAnyPreviewMode()
          ? databaseProducts
          : applyLocalProductOverrides(previewProducts(selectedBranchId));
      setProducts(nextProducts);
      if (productId) {
        setProduct(nextProducts.find((nextProduct) => nextProduct.id === productId) ?? null);
      }
    })();
  }, [productId, selectedBranchId]);

  const onSubmit = async () => {
    const qty = Number(quantity);
    if (!isAdmin) {
      setError('Transfer inaruhusiwa kwa Owner au Manager pekee');
      return;
    }
    if (!product) {
      setError('Chagua bidhaa ya kuhamisha');
      return;
    }
    if (!toBranchId) {
      setError('Chagua branch ya kwenda');
      return;
    }
    if (!qty || qty <= 0) {
      setError('Weka quantity sahihi');
      return;
    }
    if (qty > product.quantity) {
      setError('Quantity ya kuhamisha imezidi stock iliyopo');
      return;
    }

    setError(null);
    setLoading(true);

    if (isAnyPreviewMode()) {
      const nextQuantity = product.quantity - qty;
      saveLocalProductOverride(product.id, { quantity: nextQuantity });
      await recordLocalStockMovement({
        branch_id: selectedBranchId,
        product,
        type: 'OUT',
        quantity: qty,
        note: note.trim() || `Transfer kwenda ${toBranchId}`,
        created_by: session?.user.id ?? null,
      });
      setLoading(false);
      router.replace(`/(tabs)/movements${previewQuery}` as Href);
      return;
    }

    const rpcResult = await supabase.rpc('record_stock_transfer', {
      p_product_id: product.id,
      p_from_branch_id: selectedBranchId,
      p_to_branch_id: toBranchId,
      p_quantity: qty,
      p_note: note.trim() || null,
    });

    if (!rpcResult.error) {
      setLoading(false);
      router.back();
      return;
    }

    const rpcMessage = rpcResult.error.message.toLowerCase();
    if (
      !rpcMessage.includes('function public.record_stock_transfer') &&
      !rpcMessage.includes('could not find the function') &&
      !rpcMessage.includes('schema cache')
    ) {
      setLoading(false);
      setError(rpcResult.error.message);
      return;
    }

    let destinationProduct: Product | null = null;
    let destinationQuery = supabase
      .from('products')
      .select('*')
      .eq('branch_id', toBranchId)
      .limit(1);

    destinationQuery = product.sku
      ? destinationQuery.eq('sku', product.sku)
      : destinationQuery.eq('name', product.name);

    const { data: destinationData, error: destinationError } = await destinationQuery.maybeSingle();

    if (destinationError?.message.includes('branch_id')) {
      setLoading(false);
      setError('Run SQL ya branches kwenye Supabase kwanza ili transfer ifanye kazi.');
      return;
    }

    destinationProduct = (destinationData as Product | null) ?? null;

    if (!destinationProduct) {
      const { data: createdProduct, error: createProductError } = await supabase
        .from('products')
        .insert({
          branch_id: toBranchId,
          name: product.name,
          sku: product.sku,
          unit: product.unit,
          category: product.category,
          quantity: 0,
          reorder_level: product.reorder_level,
          cost_price: product.cost_price,
          unit_price: product.unit_price,
        created_by: session?.user.id,
      })
        .select('*')
        .single();

      if (createProductError) {
        setLoading(false);
        setError(createProductError.message);
        return;
      }

      destinationProduct = createdProduct as Product;
    }

    const { error: transferError } = await supabase.from('stock_transfers').insert({
      product_id: product.id,
      from_branch_id: selectedBranchId,
      to_branch_id: toBranchId,
      quantity: qty,
      note: note.trim() || null,
      created_by: session?.user.id,
    });

    setLoading(false);

    if (transferError) {
      if (transferError.message.includes('stock_transfers')) {
        setError('Run SQL ya branches/stock transfers kwenye Supabase kwanza.');
        return;
      }
      setError(transferError.message);
      return;
    }

    const transferNote = note.trim() || `Transfer kwenda ${toBranchId}`;
    const { error: movementError } = await supabase.from('stock_movements').insert([
      {
        branch_id: selectedBranchId,
        product_id: product.id,
        type: 'OUT',
        quantity: qty,
        note: transferNote,
        created_by: session?.user.id,
      },
      {
        branch_id: toBranchId,
        product_id: destinationProduct.id,
        type: 'IN',
        quantity: qty,
        note: `Transfer kutoka ${selectedBranch?.name ?? selectedBranchId}`,
        created_by: session?.user.id,
      },
    ]);

    if (movementError) {
      setLoading(false);
      setError(movementError.message);
      return;
    }

    router.back();
  };

  if (!isAdmin) {
    return (
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.permissionBox}>
          <Text style={styles.permissionTitle}>Owner/Manager pekee</Text>
          <Text style={styles.permissionText}>Cashier hawezi kuhamisha stock kati ya branches.</Text>
          <Button label="Rudi Stock" onPress={() => router.replace(`/(tabs)/movements${previewQuery}` as Href)} />
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.branchHint}>Kutoka: {selectedBranch?.name}</Text>

        <Text style={styles.label}>Kwenda Branch *</Text>
        <View style={styles.branchOptions}>
          {destinationBranches.map((branch) => {
            const active = branch.id === toBranchId;
            return (
              <Pressable
                key={branch.id}
                style={[styles.branchOption, active && styles.branchOptionActive]}
                onPress={() => setToBranchId(branch.id)}>
                <Text style={[styles.branchOptionText, active && styles.branchOptionTextActive]}>
                  {branch.name}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <ProductPicker label="Bidhaa *" products={products} value={product} onChange={setProduct} />

        {product ? (
          <Text style={styles.currentStock}>
            Stock iliyopo: {product.quantity} {product.unit}
          </Text>
        ) : null}

        <TextField
          label="Quantity ya kuhamisha *"
          value={quantity}
          onChangeText={setQuantity}
          keyboardType="numeric"
        />
        <TextField
          label="Maelezo (hiari)"
          value={note}
          onChangeText={setNote}
          placeholder="Mfano: Kuhamisha stock branch nyingine"
          multiline
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button label="Hifadhi Transfer" onPress={onSubmit} loading={loading} />
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
  permissionBox: {
    flex: 1,
    padding: Spacing.lg,
    justifyContent: 'center',
    gap: Spacing.md,
  },
  permissionTitle: {
    color: Colors.text,
    fontSize: 24,
    fontWeight: '600',
  },
  permissionText: {
    color: Colors.textMuted,
    fontWeight: '400',
    lineHeight: 22,
  },
  branchHint: {
    color: Colors.primaryDark,
    backgroundColor: Colors.primarySoft,
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    fontWeight: '400',
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  branchOptions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  branchOption: {
    flex: 1,
    minHeight: 44,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing.sm,
  },
  branchOptionActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primarySoft,
  },
  branchOptionText: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: '400',
    textAlign: 'center',
  },
  branchOptionTextActive: {
    color: Colors.primaryDark,
  },
  currentStock: {
    fontSize: 13,
    color: Colors.textMuted,
    marginTop: -Spacing.sm,
    marginBottom: Spacing.lg,
  },
  error: {
    color: Colors.danger,
    marginBottom: Spacing.lg,
    textAlign: 'center',
  },
});
