import { router, useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { ProductListItem } from '@/components/product-list-item';
import { Screen } from '@/components/screen';
import { Colors, Radius, Spacing } from '@/constants/colors';
import { isAnyPreviewMode, useAuth } from '@/lib/auth-context';
import { useBranch } from '@/lib/branch-context';
import { applyLocalProductOverrides } from '@/lib/local-product-overrides';
import { setupDemoProducts } from '@/lib/setup-wizard';
import { supabase } from '@/lib/supabase';
import type { Product } from '@/types/database';

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

export default function ProductsScreen() {
  const { isOwner } = useAuth();
  const { selectedBranchId } = useBranch();
  const [products, setProducts] = useState<Product[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      let { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('branch_id', selectedBranchId)
        .order('name');

      if (error?.message.includes('branch_id')) {
        const fallback = await supabase.from('products').select('*').order('name');
        data = fallback.data;
        error = fallback.error;
      }

      if (error && isAnyPreviewMode()) {
        setProducts(previewProducts(selectedBranchId));
        return;
      }

      const databaseProducts = applyLocalProductOverrides((data as Product[]) ?? []);
      setProducts(databaseProducts.length > 0 || !isAnyPreviewMode() ? databaseProducts : previewProducts(selectedBranchId));
    } catch {
      setProducts(isAnyPreviewMode() ? previewProducts(selectedBranchId) : []);
    }
  }, [selectedBranchId]);

  useFocusEffect(
    useCallback(() => {
      let active = true;
      (async () => {
        setLoading(true);
        await load();
        if (active) setLoading(false);
      })();
      return () => {
        active = false;
      };
    }, [load])
  );

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q)
    );
  }, [products, search]);

  return (
    <Screen>
      <View style={styles.toolbar}>
        <TextInput
          style={styles.search}
          placeholder="Tafuta bidhaa au SKU..."
          placeholderTextColor={Colors.textMuted}
          value={search}
          onChangeText={setSearch}
        />
        {isOwner ? (
          <Pressable style={styles.addButton} onPress={() => router.push('/(tabs)/products/new')}>
            <Text style={styles.addButtonText}>+ Ongeza</Text>
          </Pressable>
        ) : null}
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshing={refreshing}
          onRefresh={onRefresh}
          renderItem={({ item }) => (
            <ProductListItem
              product={item}
              onPress={() => router.push(`/(tabs)/products/${item.id}`)}
            />
          )}
          ListEmptyComponent={
            <EmptyState
              title="Hakuna bidhaa"
              subtitle="Bonyeza '+ Ongeza' kuanza kuongeza bidhaa kwenye godown."
            />
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  search: {
    flex: 1,
    height: 44,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.surface,
    color: Colors.text,
  },
  addButton: {
    height: 44,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonText: {
    color: Colors.white,
    fontWeight: '600',
  },
  bundleButton: {
    height: 44,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bundleButtonText: {
    color: Colors.primaryDark,
    fontWeight: '600',
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    paddingBottom: Spacing.xxl,
  },
});
