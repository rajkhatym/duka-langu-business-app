import { router, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text } from 'react-native';

import { Button } from '@/components/button';
import { TextField } from '@/components/text-field';
import { Colors, Spacing } from '@/constants/colors';
import { isOwnerPreviewMode, useAuth } from '@/lib/auth-context';
import { useBranch } from '@/lib/branch-context';
import { saveLocalProduct } from '@/lib/local-product-overrides';
import { supabase } from '@/lib/supabase';
import { isMissingCostPriceError } from '@/lib/supabase-errors';
import { userFacingError } from '@/lib/user-facing-errors';
import type { Product } from '@/types/database';

export default function NewProductScreen() {
  const { sku: routeSku, returnTo } = useLocalSearchParams<{ sku?: string; returnTo?: string }>();
  const { isOwner, session } = useAuth();
  const { selectedBranchId, selectedBranch } = useBranch();
  const [name, setName] = useState('');
  const [unit, setUnit] = useState('pcs');
  const [costPrice, setCostPrice] = useState('');
  const [unitPrice, setUnitPrice] = useState('');
  const [quantity, setQuantity] = useState('0');
  const [error, setError] = useState<string | null>(null);
  const [duplicateProduct, setDuplicateProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(false);

  if (!isOwner) {
    return (
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.permissionBox}>
          <Text style={styles.permissionTitle}>Owner pekee</Text>
          <Text style={styles.permissionText}>
            Bidhaa mpya inaingiza stock ya awali, kwa hiyo imefungwa kwa Owner pekee.
          </Text>
          <Button label="Rudi Stock" onPress={() => router.replace('/(tabs)/products')} />
        </ScrollView>
      </KeyboardAvoidingView>
    );
  }

  const useExistingProduct = () => {
    if (!duplicateProduct) return;
    router.replace({
      pathname: '/(tabs)/sales/new',
      params: {
        owner: 'preview',
        createdProduct: duplicateProduct.id,
        createdSku: duplicateProduct.sku ?? duplicateProduct.name,
        createdQty: String(duplicateProduct.quantity),
        createdAt: String(Date.now()),
        selectedExisting: '1',
      },
    });
  };

  const openExistingProduct = () => {
    if (!duplicateProduct) return;
    router.push(
      `/(tabs)/products/${duplicateProduct.id}?returnTo=sales${isOwnerPreviewMode() ? '&owner=preview' : ''}`
    );
  };

  const onSubmit = async () => {
    if (!name.trim() || !unit.trim()) {
      setError('Tafadhali jaza jina la bidhaa na kipimo (unit)');
      return;
    }
    setError(null);
    setLoading(true);

    const productPayload = {
      branch_id: selectedBranchId,
      name: name.trim(),
      sku: routeSku?.trim() || null,
      unit: unit.trim(),
      category: null,
      variant_size: null,
      variant_color: null,
      variant_weight: null,
      warranty_months: null,
      quantity: Number(quantity) || 0,
      reorder_level: 0,
      cost_price: isOwner && costPrice.trim() ? Number(costPrice) : null,
      unit_price: unitPrice.trim() ? Number(unitPrice) : null,
      created_by: session?.user.id,
    };

    setDuplicateProduct(null);

    if (isOwnerPreviewMode()) {
      const localProductId = `local-${Date.now()}`;
      saveLocalProduct({
        id: localProductId,
        branch_id: selectedBranchId,
        name: productPayload.name,
        sku: productPayload.sku,
        unit: productPayload.unit,
        category: productPayload.category,
        variant_size: productPayload.variant_size,
        variant_color: productPayload.variant_color,
        variant_weight: productPayload.variant_weight,
        warranty_months: productPayload.warranty_months,
        quantity: productPayload.quantity,
        reorder_level: productPayload.reorder_level,
        cost_price: productPayload.cost_price,
        unit_price: productPayload.unit_price,
        created_by: session?.user.id ?? null,
        created_at: new Date().toISOString(),
      });
      setLoading(false);
      if (returnTo === 'sales') {
        router.replace({
          pathname: '/(tabs)/sales/new',
          params: {
            owner: 'preview',
            createdProduct: localProductId,
            createdSku: productPayload.sku ?? productPayload.name,
            createdQty: String(productPayload.quantity),
            createdAt: String(Date.now()),
          },
        });
        return;
      }
      router.back();
      return;
    }

    let { error: insertError } = await supabase.from('products').insert(productPayload);

    if (isMissingCostPriceError(insertError)) {
      const { cost_price: _costPrice, ...fallbackPayload } = productPayload;
      const fallbackResult = await supabase.from('products').insert(fallbackPayload);
      insertError = fallbackResult.error;
    }

    if (insertError?.message.includes('branch_id')) {
      const { branch_id: _branchId, ...fallbackPayload } = productPayload;
      const fallbackResult = await supabase.from('products').insert(fallbackPayload);
      insertError = fallbackResult.error;
    }

    if (insertError?.message.includes('variant_') || insertError?.message.includes('warranty_months')) {
      const {
        variant_size: _variantSize,
        variant_color: _variantColor,
        variant_weight: _variantWeight,
        warranty_months: _warrantyMonths,
        ...fallbackPayload
      } = productPayload;
      const fallbackResult = await supabase.from('products').insert(fallbackPayload);
      insertError = fallbackResult.error;
    }

    setLoading(false);

    if (insertError) {
      setError(userFacingError(insertError.message));
      return;
    }

    if (returnTo === 'sales') {
      router.replace({
        pathname: '/(tabs)/sales/new',
        params: {
          owner: 'preview',
          createdSku: productPayload.sku ?? productPayload.name,
          createdAt: String(Date.now()),
        },
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
        <TextField label="Jina la Bidhaa *" value={name} onChangeText={setName} placeholder="Mfano: Dumbbell 10kg Pair" />
        <TextField label="Kipimo (unit) *" value={unit} onChangeText={setUnit} placeholder="pcs, kg, box..." />
        <TextField
          label="Kiasi cha awali (Opening stock)"
          value={quantity}
          onChangeText={setQuantity}
          keyboardType="numeric"
        />
        {isOwner ? (
          <TextField
            label="Bei ya Manunuzi kwa kipimo"
            value={costPrice}
            onChangeText={setCostPrice}
            keyboardType="numeric"
            placeholder="Tsh"
          />
        ) : null}
        <TextField
          label="Bei ya Kuuza kwa kipimo"
          value={unitPrice}
          onChangeText={setUnitPrice}
          keyboardType="numeric"
          placeholder="Tsh"
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {duplicateProduct && returnTo === 'sales' ? (
          <>
            <Pressable style={styles.useExistingButton} onPress={useExistingProduct}>
              <Text style={styles.useExistingButtonText}>Tumia bidhaa iliyopo</Text>
            </Pressable>
            <Pressable style={styles.openExistingButton} onPress={openExistingProduct}>
              <Text style={styles.openExistingButtonText}>Fungua bidhaa iliyopo</Text>
            </Pressable>
          </>
        ) : null}

        <Button label="Hifadhi Bidhaa" onPress={onSubmit} loading={loading} />
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
    flexGrow: 1,
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
  error: {
    color: Colors.danger,
    marginBottom: Spacing.lg,
    textAlign: 'center',
  },
  useExistingButton: {
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.md,
  },
  useExistingButtonText: {
    color: Colors.primaryDark,
    fontSize: 14,
    fontWeight: '600',
  },
  openExistingButton: {
    minHeight: 46,
    borderRadius: 12,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
    marginBottom: Spacing.lg,
  },
  openExistingButtonText: {
    color: Colors.primary,
    fontSize: 14,
    fontWeight: '600',
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
