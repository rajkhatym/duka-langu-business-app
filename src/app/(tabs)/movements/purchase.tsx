import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { ProductPicker } from '@/components/product-picker';
import { TextField } from '@/components/text-field';
import { Colors, Spacing } from '@/constants/colors';
import { isOwnerPreviewMode, useAuth } from '@/lib/auth-context';
import { useBranch } from '@/lib/branch-context';
import { formatMoney } from '@/lib/format';
import { applyLocalProductOverrides, saveLocalProductOverride } from '@/lib/local-product-overrides';
import { recordLocalPurchase } from '@/lib/local-purchases';
import { recordLocalStockMovement } from '@/lib/local-stock-movements';
import { supabase } from '@/lib/supabase';
import type { Product, SupplierPaymentStatus } from '@/types/database';

function paymentStatus(total: number, paid: number): SupplierPaymentStatus {
  if (paid >= total) return 'paid';
  if (paid > 0) return 'partial';
  return 'credit';
}

export default function PurchaseScreen() {
  const { productId, qty: routeQuantity, cost: routeCost, returnTo } = useLocalSearchParams<{
    productId?: string;
    qty?: string;
    cost?: string;
    returnTo?: string;
  }>();
  const { session, isOwner } = useAuth();
  const { selectedBranch, selectedBranchId } = useBranch();
  const [products, setProducts] = useState<Product[]>([]);
  const [product, setProduct] = useState<Product | null>(null);
  const [supplierName, setSupplierName] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [quantity, setQuantity] = useState(routeQuantity ?? '');
  const [costPrice, setCostPrice] = useState(routeCost ?? '');
  const [amountPaid, setAmountPaid] = useState('');
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
        const routeProduct = nextProducts.find((nextProduct) => nextProduct.id === productId) ?? null;
        setProduct(routeProduct);
        if (!routeCost && routeProduct?.cost_price) setCostPrice(String(routeProduct.cost_price));
      }
    })();
  }, [productId, routeCost, selectedBranchId]);

  useEffect(() => {
    if (product?.cost_price) setCostPrice(String(product.cost_price));
  }, [product]);

  const qty = Number(quantity) || 0;
  const cost = Number(costPrice) || 0;
  const paid = Number(amountPaid) || 0;
  const total = qty * cost;
  const balance = Math.max(total - paid, 0);

  if (!isOwner) {
    return (
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.permissionBox}>
          <Text style={styles.permissionTitle}>Owner pekee</Text>
          <Text style={styles.permissionText}>
            Purchase inaongeza stock na supplier ledger, kwa hiyo imefungwa kwa Owner pekee.
          </Text>
          <Button label="Rudi Stock" onPress={() => router.replace('/(tabs)/movements')} />
        </View>
      </KeyboardAvoidingView>
    );
  }

  const onSubmit = async () => {
    if (!supplierName.trim()) {
      setError('Weka jina la supplier');
      return;
    }
    if (!product) {
      setError('Chagua bidhaa');
      return;
    }
    if (!qty || qty <= 0 || !cost || cost <= 0) {
      setError('Weka quantity na cost price sahihi');
      return;
    }
    if (paid > total) {
      setError('Malipo hayawezi kuzidi jumla ya invoice');
      return;
    }

    setError(null);
    setLoading(true);

    const purchasePayload = {
      branch_id: selectedBranchId,
      supplier_name: supplierName.trim(),
      invoice_number: invoiceNumber.trim() || null,
      product_id: product.id,
      quantity: qty,
      cost_price: cost,
      amount_paid: paid,
      payment_status: paymentStatus(total, paid),
      note: note.trim() || null,
      created_by: session?.user.id,
    };

    if (isOwnerPreviewMode()) {
      saveLocalProductOverride(product.id, {
        quantity: product.quantity + qty,
        cost_price: cost,
      });
      await recordLocalPurchase({
        branch_id: selectedBranchId,
        supplier_name: supplierName.trim(),
        invoice_number: invoiceNumber.trim() || null,
        product: { ...product, cost_price: cost },
        quantity: qty,
        cost_price: cost,
        amount_paid: paid,
        payment_status: paymentStatus(total, paid),
        note: note.trim() || null,
        created_by: session?.user.id ?? null,
      });
      await recordLocalStockMovement({
        branch_id: selectedBranchId,
        product: { ...product, cost_price: cost },
        type: 'IN',
        quantity: qty,
        note: `Purchase ${invoiceNumber.trim() || supplierName.trim()}`,
        created_by: session?.user.id ?? null,
      });
      setLoading(false);
      if (returnTo === 'product') {
        router.replace({
          pathname: '/(tabs)/products/[id]',
          params: {
            id: product.id,
            owner: 'preview',
          },
        });
        return;
      }
      router.back();
      return;
    }

    let { error: purchaseError } = await supabase.from('purchases').insert(purchasePayload);

    if (purchaseError?.message.includes('purchases')) {
      setLoading(false);
      setError('Run SQL ya purchases/suppliers kwenye Supabase kwanza.');
      return;
    }

    if (purchaseError?.message.includes('branch_id')) {
      const { branch_id: _branchId, ...fallbackPayload } = purchasePayload;
      const fallback = await supabase.from('purchases').insert(fallbackPayload);
      purchaseError = fallback.error;
    }

    if (purchaseError) {
      setLoading(false);
      setError(purchaseError.message);
      return;
    }

    const { error: movementError } = await supabase.from('stock_movements').insert({
      branch_id: selectedBranchId,
      product_id: product.id,
      type: 'IN',
      quantity: qty,
      note: `Purchase ${invoiceNumber.trim() || supplierName.trim()}`,
      created_by: session?.user.id,
    });

    if (movementError) {
      setLoading(false);
      setError(movementError.message);
      return;
    }

    await supabase.from('products').update({ cost_price: cost }).eq('id', product.id);

    setLoading(false);
    router.back();
  };

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.branchHint}>Branch: {selectedBranch?.name}</Text>
        <TextField label="Supplier name *" value={supplierName} onChangeText={setSupplierName} />
        <TextField label="Invoice number" value={invoiceNumber} onChangeText={setInvoiceNumber} />
        <ProductPicker label="Bidhaa *" products={products} value={product} onChange={setProduct} />
        <View style={styles.row}>
          <TextField
            label="Quantity *"
            value={quantity}
            onChangeText={setQuantity}
            keyboardType="numeric"
            style={styles.halfInput}
          />
          <TextField
            label="Cost price *"
            value={costPrice}
            onChangeText={setCostPrice}
            keyboardType="numeric"
            style={styles.halfInput}
          />
        </View>
        <TextField label="Amount paid" value={amountPaid} onChangeText={setAmountPaid} keyboardType="numeric" />
        <View style={styles.summary}>
          <Text style={styles.summaryText}>Jumla: Tsh {formatMoney(total)}</Text>
          <Text style={[styles.summaryText, balance > 0 && styles.debtText]}>
            Supplier balance: Tsh {formatMoney(balance)}
          </Text>
        </View>
        <TextField label="Note" value={note} onChangeText={setNote} multiline />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button label="Hifadhi Purchase" onPress={onSubmit} loading={loading} />
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
    fontWeight: '400',
    marginBottom: Spacing.lg,
  },
  row: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  halfInput: {
    minWidth: 0,
  },
  summary: {
    backgroundColor: Colors.primarySoft,
    padding: Spacing.md,
    borderRadius: 8,
    marginBottom: Spacing.lg,
    gap: Spacing.xs,
  },
  summaryText: {
    color: Colors.text,
    fontWeight: '400',
  },
  debtText: {
    color: Colors.warning,
  },
  error: {
    color: Colors.danger,
    marginBottom: Spacing.lg,
    textAlign: 'center',
  },
});
