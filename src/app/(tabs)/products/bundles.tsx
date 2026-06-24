import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Platform, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { ProductPicker } from '@/components/product-picker';
import { TextField } from '@/components/text-field';
import { Colors, Radius, Spacing } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useBranch } from '@/lib/branch-context';
import { formatDateTime, formatMoney } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import type { Product, ProductBundle } from '@/types/database';

type BundleLine = {
  product: Product;
  quantity: number;
};

type BundleItem = {
  id: string;
  bundle_id: string;
  product_id: string;
  quantity: number;
  products?: Pick<Product, 'id' | 'name' | 'unit' | 'sku'> | null;
};

export default function BundlesScreen() {
  const { session } = useAuth();
  const { selectedBranch, selectedBranchId } = useBranch();
  const [products, setProducts] = useState<Product[]>([]);
  const [bundles, setBundles] = useState<ProductBundle[]>([]);
  const [product, setProduct] = useState<Product | null>(null);
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [bundlePrice, setBundlePrice] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [lines, setLines] = useState<BundleLine[]>([]);
  const [selectedBundle, setSelectedBundle] = useState<ProductBundle | null>(null);
  const [selectedItems, setSelectedItems] = useState<BundleItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.from('products').select('*').eq('branch_id', selectedBranchId).order('name');
      setProducts((data as Product[]) ?? []);
    })();
  }, [selectedBranchId]);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('product_bundles')
      .select('*')
      .eq('branch_id', selectedBranchId)
      .order('created_at', { ascending: false })
      .limit(50);
    setBundles((data as ProductBundle[]) ?? []);
  }, [selectedBranchId]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const bundleText = useMemo(() => {
    if (!selectedBundle) return '';
    return [
      selectedBranch?.name ?? 'Duka Langu',
      'PACKAGE / BUNDLE',
      `Name: ${selectedBundle.name}`,
      selectedBundle.sku ? `SKU: ${selectedBundle.sku}` : null,
      '',
      ...selectedItems.map(
        (item, index) =>
          `${index + 1}. ${item.products?.name ?? item.product_id} x ${item.quantity} ${item.products?.unit ?? ''}`
      ),
      '',
      `Bundle Price: Tsh ${formatMoney(selectedBundle.bundle_price)}`,
    ]
      .filter((line) => line !== null)
      .join('\n');
  }, [selectedBundle, selectedBranch?.name, selectedItems]);

  const openBundle = async (bundle: ProductBundle) => {
    const { data, error: itemsError } = await supabase
      .from('product_bundle_items')
      .select('*, products(id,name,unit,sku)')
      .eq('bundle_id', bundle.id)
      .order('id');
    if (itemsError) {
      Alert.alert('Hitilafu', itemsError.message);
      return;
    }
    setSelectedBundle(bundle);
    setSelectedItems((data as unknown as BundleItem[]) ?? []);
  };

  const copyBundle = async () => {
    if (!bundleText) return;
    if (Platform.OS === 'web' && typeof navigator !== 'undefined' && navigator.clipboard) {
      await navigator.clipboard.writeText(bundleText);
      Alert.alert('Bundle', 'Bundle text ime-copy.');
      return;
    }
    await Share.share({ message: bundleText });
  };

  const addLine = () => {
    const qty = Number(quantity) || 0;
    if (!product || qty <= 0) {
      setError('Chagua bidhaa na quantity kabla ya kuongeza item');
      return;
    }
    setLines((current) => [...current, { product, quantity: qty }]);
    setProduct(null);
    setQuantity('1');
    setError(null);
  };

  const onSubmit = async () => {
    const price = Number(bundlePrice) || 0;
    if (!name.trim() || lines.length === 0 || price <= 0) {
      setError('Jaza bundle name, ongeza items na price');
      return;
    }
    setError(null);
    setLoading(true);
    const { data: bundle, error: bundleError } = await supabase
      .from('product_bundles')
      .insert({
        branch_id: selectedBranchId,
        name: name.trim(),
        sku: sku.trim() || null,
        bundle_price: price,
        created_by: session?.user.id,
      })
      .select('*')
      .single();

    if (bundleError) {
      setLoading(false);
      setError(bundleError.message.includes('product_bundles') ? 'Run SQL ya equipment sales modules kwanza.' : bundleError.message);
      return;
    }

    await supabase.from('product_bundle_items').insert(
      lines.map((line) => ({
        bundle_id: bundle.id,
        product_id: line.product.id,
        quantity: line.quantity,
      }))
    );

    setLoading(false);
    setName('');
    setSku('');
    setBundlePrice('');
    setQuantity('1');
    setProduct(null);
    setLines([]);
    await load();
  };

  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.content}>
      <Text style={styles.branchHint}>Branch: {selectedBranch?.name}</Text>
      <View style={styles.card}>
        <Text style={styles.title}>New Bundle / Package</Text>
        <TextField label="Bundle name *" value={name} onChangeText={setName} placeholder="Home Gym Starter Pack" />
        <TextField label="SKU" value={sku} onChangeText={setSku} placeholder="BND-001" />
        <ProductPicker label="Bidhaa ya bundle *" products={products} value={product} onChange={setProduct} />
        <TextField label="Quantity" value={quantity} onChangeText={setQuantity} keyboardType="numeric" />
        <Button label="Add Item to Bundle" variant="secondary" onPress={addLine} />
        {lines.length > 0 ? (
          <View style={styles.linesBox}>
            {lines.map((line, index) => (
              <Text key={`${line.product.id}-${index}`} style={styles.lineText}>
                {index + 1}. {line.product.name} x {line.quantity}
              </Text>
            ))}
          </View>
        ) : null}
        <TextField label="Bundle price *" value={bundlePrice} onChangeText={setBundlePrice} keyboardType="numeric" />
        {error ? <Text style={styles.error}>{error}</Text> : null}
        <Button label="Save Bundle" onPress={onSubmit} loading={loading} />
      </View>

      <Text style={styles.sectionTitle}>Bundles</Text>
      {selectedBundle ? (
        <View style={styles.documentCard}>
          <View style={styles.listTop}>
            <Text style={styles.title}>Bundle Preview</Text>
            <Text onPress={() => setSelectedBundle(null)} style={styles.closeText}>Funga</Text>
          </View>
          <Text style={styles.documentText}>{bundleText}</Text>
          <Button label="Copy Bundle Text" onPress={copyBundle} />
        </View>
      ) : null}
      {bundles.length === 0 ? (
        <Text style={styles.empty}>Hakuna bundles bado.</Text>
      ) : (
        bundles.map((bundle) => <BundleRow key={bundle.id} bundle={bundle} onOpen={() => openBundle(bundle)} />)
      )}
    </ScrollView>
  );
}

function BundleRow({ bundle, onOpen }: { bundle: ProductBundle; onOpen: () => void }) {
  return (
    <Pressable style={styles.listCard} onPress={onOpen}>
      <View style={styles.listTop}>
        <Text style={styles.customer}>{bundle.name}</Text>
        <Text style={styles.amount}>Tsh {formatMoney(bundle.bundle_price)}</Text>
      </View>
      <Text style={styles.meta}>{bundle.sku ?? 'No SKU'} | {bundle.active ? 'Active' : 'Inactive'} | {formatDateTime(bundle.created_at)}</Text>
      <Text style={styles.openHint}>Tap to preview/copy</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: Colors.background },
  content: { padding: Spacing.lg, paddingBottom: 120 },
  branchHint: { color: Colors.primaryDark, fontWeight: '400', marginBottom: Spacing.lg },
  card: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, padding: Spacing.lg },
  title: { color: Colors.text, fontSize: 18, fontWeight: '600', marginBottom: Spacing.md },
  error: { color: Colors.danger, textAlign: 'center', marginBottom: Spacing.md },
  linesBox: { backgroundColor: Colors.primarySoft, borderRadius: Radius.md, padding: Spacing.md, marginVertical: Spacing.md, gap: Spacing.xs },
  lineText: { color: Colors.primaryDark, fontWeight: '400' },
  sectionTitle: { color: Colors.text, fontSize: 17, fontWeight: '600', marginTop: Spacing.xl, marginBottom: Spacing.md },
  empty: { color: Colors.textMuted },
  listCard: { backgroundColor: Colors.surface, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md, padding: Spacing.md, marginBottom: Spacing.md },
  listTop: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
  customer: { flex: 1, color: Colors.text, fontWeight: '600' },
  amount: { color: Colors.success, fontWeight: '600' },
  meta: { color: Colors.textMuted, marginTop: Spacing.xs },
  openHint: { color: Colors.primaryDark, fontWeight: '400', marginTop: Spacing.sm },
  documentCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    gap: Spacing.md,
  },
  documentText: {
    color: Colors.text,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : Platform.OS === 'android' ? 'monospace' : 'monospace',
    lineHeight: 20,
  },
  closeText: { color: Colors.danger, fontWeight: '600' },
});
