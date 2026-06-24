import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { Button } from '@/components/button';
import { ProductPicker } from '@/components/product-picker';
import { TextField } from '@/components/text-field';
import { Colors, Radius, Spacing } from '@/constants/colors';
import { isOwnerPreviewMode, useAuth } from '@/lib/auth-context';
import { useBranch } from '@/lib/branch-context';
import { applyLocalProductOverrides, saveLocalProductOverride } from '@/lib/local-product-overrides';
import { recordLocalStockMovement } from '@/lib/local-stock-movements';
import { supabase } from '@/lib/supabase';
import type { MovementType, Product } from '@/types/database';

const reasonPresets: Record<MovementType, string[]> = {
  IN: ['Manunuzi mapya', 'Opening stock', 'Return kutoka mteja', 'Correction ya count', 'Transfer imepokelewa'],
  OUT: ['Damage / imeharibika', 'Stock count correction', 'Sample / matumizi ya ndani', 'Transfer kwenda branch', 'Imeisha / lost'],
};

export default function NewMovementScreen() {
  const { productId, type: routeType, returnTo, qty: routeQuantity } = useLocalSearchParams<{
    productId?: string;
    type?: MovementType;
    returnTo?: string;
    qty?: string;
  }>();
  const { session, isOwner } = useAuth();
  const { selectedBranchId, selectedBranch } = useBranch();
  const [products, setProducts] = useState<Product[]>([]);
  const [product, setProduct] = useState<Product | null>(null);
  const [type, setType] = useState<MovementType>(routeType === 'OUT' ? 'OUT' : 'IN');
  const [quantity, setQuantity] = useState(routeQuantity ?? '');
  const [note, setNote] = useState(returnTo === 'sales' ? 'Restock kutoka low stock alert' : '');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const qty = Number(quantity);
  const hasQuantity = !Number.isNaN(qty) && qty > 0;
  const currentQuantity = product?.quantity ?? 0;
  const nextQuantity =
    product && hasQuantity ? (type === 'IN' ? currentQuantity + qty : currentQuantity - qty) : currentQuantity;
  const isStockOutTooHigh = Boolean(product && type === 'OUT' && hasQuantity && qty > currentQuantity);
  const isLowAfterMovement = Boolean(product && product.reorder_level > 0 && nextQuantity <= product.reorder_level);
  const ownerPreviewMode = isOwnerPreviewMode();
  const ownerParam = ownerPreviewMode ? { owner: 'preview' } : {};
  const movementWord = type === 'IN' ? 'kuongeza' : 'kutoa';
  const saveLabel = type === 'IN' ? 'Hifadhi Stock In' : 'Hifadhi Stock Out';

  useEffect(() => {
    (async () => {
      let { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('branch_id', selectedBranchId)
        .order('name');
      if (error?.message.includes('branch_id')) {
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

  if (!isOwner) {
    return (
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.permissionBox}>
          <Text style={styles.permissionTitle}>Owner pekee</Text>
          <Text style={styles.permissionText}>
            Manager anaweza kuona stock, lakini hawezi kuingiza au kutoa stock. Muombe Owner afanye adjustment.
          </Text>
          <Button label="Rudi Stock" onPress={() => router.replace('/(tabs)/movements')} />
        </View>
      </KeyboardAvoidingView>
    );
  }

  const onSubmit = async () => {
    if (!product) {
      setError('Tafadhali chagua bidhaa');
      return;
    }
    if (!hasQuantity) {
      setError('Tafadhali jaza kiasi sahihi (zaidi ya 0)');
      return;
    }
    if (isStockOutTooHigh) {
      setError('Stock Out imezidi stock iliyopo.');
      return;
    }

    setError(null);
    setLoading(true);

    if (ownerPreviewMode) {
      saveLocalProductOverride(product.id, { quantity: nextQuantity });
      await recordLocalStockMovement({
        branch_id: selectedBranchId,
        product,
        type,
        quantity: qty,
        note: note.trim() || null,
        created_by: session?.user.id ?? null,
      });
      setLoading(false);
      if (returnTo === 'sales') {
        router.replace({
          pathname: '/(tabs)/sales/new',
          params: {
            owner: 'preview',
            restockedProduct: product.id,
            restockedQty: String(qty),
            restockedAt: String(Date.now()),
          },
        });
        return;
      }
      if (returnTo === 'product') {
        router.replace({
          pathname: '/(tabs)/products/[id]',
          params: { id: product.id, ...ownerParam },
        });
        return;
      }
      router.back();
      return;
    }

    const movementPayload = {
      branch_id: selectedBranchId,
      product_id: product.id,
      type,
      quantity: qty,
      note: note.trim() || null,
      created_by: session?.user.id,
    };

    let { error: insertError } = await supabase.from('stock_movements').insert(movementPayload);

    if (insertError?.message.includes('branch_id')) {
      const { branch_id: _branchId, ...fallbackPayload } = movementPayload;
      const fallback = await supabase.from('stock_movements').insert(fallbackPayload);
      insertError = fallback.error;
    }

    setLoading(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    if (returnTo === 'product') {
      router.replace({
        pathname: '/(tabs)/products/[id]',
        params: { id: product.id, ...ownerParam },
      });
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
        <ProductPicker label="Bidhaa *" products={products} value={product} onChange={setProduct} />

        {product ? (
          <View style={styles.stockPreview}>
            <View>
              <Text style={styles.stockPreviewLabel}>Stock ya sasa</Text>
              <Text style={styles.stockPreviewValue}>
                {product.quantity} {product.unit}
              </Text>
            </View>
            <View style={styles.stockPreviewDivider} />
            <View>
              <Text style={styles.stockPreviewLabel}>Baada ya hifadhi</Text>
              <Text
                style={[
                  styles.stockPreviewValue,
                  isStockOutTooHigh && styles.stockPreviewDanger,
                  isLowAfterMovement && !isStockOutTooHigh && styles.stockPreviewWarning,
                ]}>
                {hasQuantity ? nextQuantity : product.quantity} {product.unit}
              </Text>
            </View>
          </View>
        ) : null}

        <Text style={styles.label}>Aina ya Mzunguko *</Text>
        <View style={styles.typeRow}>
          <Pressable
            style={[styles.typeButton, type === 'IN' && styles.typeButtonInActive]}
            onPress={() => setType('IN')}>
            <Text style={[styles.typeText, type === 'IN' && styles.typeTextActive]}>
              Stock In (Inaongezwa)
            </Text>
          </Pressable>
          <Pressable
            style={[styles.typeButton, type === 'OUT' && styles.typeButtonOutActive]}
            onPress={() => setType('OUT')}>
            <Text style={[styles.typeText, type === 'OUT' && styles.typeTextActive]}>
              Stock Out (Inatoka)
            </Text>
          </Pressable>
        </View>

        <TextField
          label="Kiasi *"
          value={quantity}
          onChangeText={setQuantity}
          keyboardType="numeric"
          placeholder={product ? `Idadi ya ${product.unit}` : 'Idadi'}
        />

        {product ? (
          <View style={styles.quickQtyRow}>
            {[1, 5, 10].map((quickQty) => (
              <Pressable key={quickQty} style={styles.quickQtyButton} onPress={() => setQuantity(String(quickQty))}>
                <Text style={styles.quickQtyText}>+{quickQty}</Text>
              </Pressable>
            ))}
            {type === 'IN' && product.reorder_level > 0 ? (
              <Pressable
                style={styles.quickQtyButton}
                onPress={() => setQuantity(String(Math.max(product.reorder_level - product.quantity, 1)))}>
                <Text style={styles.quickQtyText}>Reorder</Text>
              </Pressable>
            ) : null}
            {type === 'OUT' && product.quantity > 0 ? (
              <Pressable style={styles.quickQtyButton} onPress={() => setQuantity(String(product.quantity))}>
                <Text style={styles.quickQtyText}>Zote</Text>
              </Pressable>
            ) : null}
          </View>
        ) : null}

        {isStockOutTooHigh ? (
          <Text style={styles.warningText}>Stock Out imezidi stock iliyopo. Punguza quantity kabla ya kuhifadhi.</Text>
        ) : null}
        {isLowAfterMovement && !isStockOutTooHigh ? (
          <Text style={styles.warningText}>
            Baada ya movement hii, stock itakuwa kwenye/ chini ya reorder level ({product?.reorder_level}).
          </Text>
        ) : null}

        <Text style={styles.label}>Sababu ya movement</Text>
        <View style={styles.reasonRow}>
          {reasonPresets[type].map((reason) => {
            const active = note === reason;
            return (
              <Pressable
                key={reason}
                style={[styles.reasonButton, active && styles.reasonButtonActive]}
                onPress={() => setNote(reason)}>
                <Text style={[styles.reasonText, active && styles.reasonTextActive]}>{reason}</Text>
              </Pressable>
            );
          })}
        </View>

        <TextField
          label="Maelezo (Hiari)"
          value={note}
          onChangeText={setNote}
          placeholder="Mfano: Imepokelewa kutoka kwa msambazaji"
          multiline
        />

        {product && hasQuantity ? (
          <View style={styles.summaryBox}>
            <Text style={styles.summaryTitle}>Muhtasari kabla ya kuhifadhi</Text>
            <Text style={styles.summaryText}>
              Uta{movementWord} {qty} {product.unit} kwa {product.name}.
            </Text>
            <Text style={styles.summaryText}>
              Stock: {currentQuantity} {'->'} {nextQuantity} {product.unit}
            </Text>
            <Text style={styles.summaryNote}>Note: {note.trim() || 'Haijawekwa'}</Text>
          </View>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button label={saveLabel} onPress={onSubmit} loading={loading} disabled={isStockOutTooHigh} />
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
  stockPreview: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  stockPreviewLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  stockPreviewValue: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '600',
    marginTop: 2,
  },
  stockPreviewDanger: {
    color: Colors.danger,
  },
  stockPreviewWarning: {
    color: Colors.warning,
  },
  stockPreviewDivider: {
    width: 1,
    height: 42,
    backgroundColor: Colors.border,
  },
  quickQtyRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginTop: -Spacing.md,
    marginBottom: Spacing.lg,
  },
  quickQtyButton: {
    minHeight: 34,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  quickQtyText: {
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '600',
  },
  warningText: {
    color: Colors.danger,
    backgroundColor: Colors.warningSoft,
    borderRadius: 10,
    padding: Spacing.md,
    marginTop: -Spacing.sm,
    marginBottom: Spacing.lg,
    fontSize: 12,
    fontWeight: '400',
  },
  reasonRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  reasonButton: {
    minHeight: 36,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  reasonButtonActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  reasonText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
  },
  reasonTextActive: {
    color: Colors.white,
  },
  summaryBox: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
  },
  summaryTitle: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '600',
    marginBottom: Spacing.xs,
  },
  summaryText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
    marginTop: 2,
  },
  summaryNote: {
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '600',
    marginTop: Spacing.xs,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  typeRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  typeButton: {
    flex: 1,
    height: 48,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.xs,
  },
  typeButtonInActive: {
    backgroundColor: Colors.success,
    borderColor: Colors.success,
  },
  typeButtonOutActive: {
    backgroundColor: Colors.danger,
    borderColor: Colors.danger,
  },
  typeText: {
    fontSize: 13,
    fontWeight: '400',
    color: Colors.textMuted,
    textAlign: 'center',
  },
  typeTextActive: {
    color: Colors.white,
  },
  error: {
    color: Colors.danger,
    marginBottom: Spacing.lg,
    textAlign: 'center',
  },
  branchHint: {
    color: Colors.primaryDark,
    backgroundColor: Colors.primarySoft,
    borderRadius: 12,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    fontWeight: '400',
  },
});
