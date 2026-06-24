import { useFocusEffect } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Button } from '@/components/button';
import { ProductPicker } from '@/components/product-picker';
import { Screen } from '@/components/screen';
import { TextField } from '@/components/text-field';
import { Colors, Radius, Spacing } from '@/constants/colors';
import { isAnyPreviewMode, useAuth } from '@/lib/auth-context';
import { useBranch } from '@/lib/branch-context';
import { formatDateTime, formatQuantity } from '@/lib/format';
import { applyLocalProductOverrides } from '@/lib/local-product-overrides';
import {
  getLocalStoreLogBookEntries,
  recordLocalStoreLogBookEntry,
  updateLocalStoreLogBookApproval,
} from '@/lib/local-store-log-book';
import { setupDemoProducts } from '@/lib/setup-wizard';
import { supabase } from '@/lib/supabase';
import type { Product, StoreLogBookEntry } from '@/types/database';

const movementTypes: { value: NonNullable<StoreLogBookEntry['movement_type']>; label: string }[] = [
  { value: 'store_to_shop', label: 'Store to Shop' },
  { value: 'store_to_customer', label: 'Store to Customer' },
  { value: 'store_to_branch', label: 'Store to Branch' },
  { value: 'return_to_store', label: 'Return to Store' },
];

function movementTypeLabel(value?: StoreLogBookEntry['movement_type']) {
  return movementTypes.find((type) => type.value === value)?.label ?? 'Store movement';
}

function statusLabel(value?: StoreLogBookEntry['status']) {
  if (value === 'approved') return 'Approved';
  if (value === 'rejected') return 'Rejected';
  return 'Pending';
}

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

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function todayStart() {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  return date;
}

export default function StoreLogBookScreen() {
  const { profile, session, isAdmin } = useAuth();
  const { selectedBranchId, selectedBranch } = useBranch();
  const previewMode = isAnyPreviewMode();
  const [products, setProducts] = useState<Product[]>([]);
  const [entries, setEntries] = useState<StoreLogBookEntry[]>([]);
  const [product, setProduct] = useState<Product | null>(null);
  const [movementType, setMovementType] = useState<NonNullable<StoreLogBookEntry['movement_type']>>('store_to_shop');
  const [personName, setPersonName] = useState(profile?.full_name ?? '');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const todayEntries = useMemo(() => {
    const start = todayStart().getTime();
    return entries.filter((entry) => new Date(entry.created_at).getTime() >= start);
  }, [entries]);

  const todayPieces = useMemo(
    () => todayEntries.reduce((sum, entry) => sum + Number(entry.quantity || 0), 0),
    [todayEntries]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      let { data: productRows, error: productError } = await supabase
        .from('products')
        .select('*')
        .eq('branch_id', selectedBranchId)
        .order('name');

      if (productError?.message.includes('branch_id')) {
        const fallback = await supabase.from('products').select('*').order('name');
        productRows = fallback.data;
      }

      const databaseProducts = applyLocalProductOverrides((productRows as Product[]) ?? []);
      const nextProducts =
        databaseProducts.length > 0 || !previewMode
          ? databaseProducts
          : applyLocalProductOverrides(previewProducts(selectedBranchId));
      setProducts(nextProducts);
      setProduct((current) => (current ? nextProducts.find((item) => item.id === current.id) ?? current : null));

      let databaseEntries: StoreLogBookEntry[] = [];
      const { data: logRows, error: logError } = await supabase
        .from('store_log_book')
        .select('*, products(id,name,unit,sku), profiles(id,full_name)')
        .eq('branch_id', selectedBranchId)
        .order('created_at', { ascending: false })
        .limit(100);

      if (logError) {
        if (!previewMode) {
          setNotice('Run SQL ya Store Log Book kwenye Supabase ili records zihifadhiwe online.');
        }
      } else {
        databaseEntries = (logRows as StoreLogBookEntry[]) ?? [];
      }

      const localEntries = previewMode ? await getLocalStoreLogBookEntries(selectedBranchId) : [];
      setEntries([...localEntries, ...databaseEntries]);
    } catch (loadError) {
      if (previewMode) {
        const localEntries = await getLocalStoreLogBookEntries(selectedBranchId);
        setProducts(applyLocalProductOverrides(previewProducts(selectedBranchId)));
        setEntries(localEntries);
      } else {
        setError(loadError instanceof Error ? loadError.message : 'Imeshindikana kusoma Store Log Book.');
      }
    } finally {
      setLoading(false);
    }
  }, [previewMode, selectedBranchId]);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const onSubmit = async () => {
    const qty = Number(quantity);
    const name = personName.trim();

    if (!name) {
      setError('Weka jina la aliyechukua mzigo.');
      return;
    }
    if (!product) {
      setError('Chagua bidhaa iliyochukuliwa.');
      return;
    }
    if (!qty || qty <= 0) {
      setError('Weka pcs/quantity sahihi.');
      return;
    }

    setSaving(true);
    setError(null);
    setNotice(null);

    if (previewMode) {
      await recordLocalStoreLogBookEntry({
        branch_id: selectedBranchId,
        movement_type: movementType,
        person_name: name,
        product,
        quantity: qty,
        note: note.trim() || null,
        created_by: session?.user.id ?? null,
      });
      setQuantity('');
      setNote('');
      setNotice('Store Log Book imehifadhiwa kwenye preview.');
      setSaving(false);
      load();
      return;
    }

    const { error: insertError } = await supabase.from('store_log_book').insert({
      branch_id: selectedBranchId,
      movement_type: movementType,
      status: 'pending',
      person_name: name,
      product_id: isUuid(product.id) ? product.id : null,
      product_name: product.name,
      quantity: qty,
      unit: product.unit,
      note: note.trim() || null,
      created_by: session?.user.id ?? null,
    });

    setSaving(false);
    if (insertError) {
      setError(insertError.message.includes('store_log_book') ? 'Run SQL ya Store Log Book kwenye Supabase kwanza.' : insertError.message);
      return;
    }

    setQuantity('');
    setNote('');
    setNotice('Store Log Book imehifadhiwa.');
    load();
  };

  const approveEntry = async (entry: StoreLogBookEntry, status: 'approved' | 'rejected') => {
    if (!isAdmin) return;
    setError(null);
    setNotice(null);

    if (previewMode) {
      await updateLocalStoreLogBookApproval({
        id: entry.id,
        status,
        approved_by: session?.user.id ?? null,
      });
      setNotice(status === 'approved' ? 'Record imethibitishwa.' : 'Record imekataliwa.');
      load();
      return;
    }

    const { error: approvalError } = await supabase
      .from('store_log_book')
      .update({
        status,
        approved_by: session?.user.id ?? null,
        approved_at: new Date().toISOString(),
      })
      .eq('id', entry.id)
      .eq('branch_id', selectedBranchId);

    if (approvalError) {
      setError(approvalError.message);
      return;
    }

    setNotice(status === 'approved' ? 'Record imethibitishwa.' : 'Record imekataliwa.');
    load();
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <View>
            <Text style={styles.title}>Store Log Book</Text>
            <Text style={styles.subtitle}>
              {selectedBranch?.name ?? 'Branch'} · rekodi mzigo uliotoka store
            </Text>
          </View>
          <Pressable style={styles.refreshButton} onPress={load}>
            <Text style={styles.refreshText}>Refresh</Text>
          </Pressable>
        </View>

        <View style={styles.summaryGrid}>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Records Leo</Text>
            <Text style={styles.summaryValue}>{todayEntries.length}</Text>
          </View>
          <View style={styles.summaryCard}>
            <Text style={styles.summaryLabel}>Pcs Leo</Text>
            <Text style={styles.summaryValue}>{formatQuantity(todayPieces)}</Text>
          </View>
        </View>

        <View style={styles.formCard}>
          <Text style={styles.sectionTitle}>Andika Mzigo Uliotoka</Text>
          <Text style={styles.fieldLabel}>Aina ya movement</Text>
          <View style={styles.typeGrid}>
            {movementTypes.map((type) => (
              <Pressable
                key={type.value}
                style={[styles.typeChip, movementType === type.value && styles.typeChipActive]}
                onPress={() => setMovementType(type.value)}>
                <Text style={[styles.typeChipText, movementType === type.value && styles.typeChipTextActive]}>
                  {type.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <TextField
            label="Jina la aliyechukua"
            value={personName}
            onChangeText={setPersonName}
            placeholder="Mfano: Yasinta Msangi"
          />
          <ProductPicker label="Bidhaa" products={products} value={product} onChange={setProduct} />
          <TextField
            label="Pcs / Quantity"
            value={quantity}
            onChangeText={setQuantity}
            placeholder="Mfano: 5"
            keyboardType="numeric"
          />
          <TextField
            label="Maelezo (hiari)"
            value={note}
            onChangeText={setNote}
            placeholder="Mfano: mzigo wa display / order ya mteja"
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
          {notice ? <Text style={styles.notice}>{notice}</Text> : null}
          <Button label="Hifadhi Log Book" onPress={onSubmit} loading={saving} disabled={products.length === 0} />
        </View>

        <View style={styles.listHeader}>
          <Text style={styles.sectionTitle}>Records za Karibuni</Text>
          <Text style={styles.metaText}>{entries.length} record(s)</Text>
        </View>

        {loading ? (
          <View style={styles.loading}>
            <ActivityIndicator color={Colors.primary} />
          </View>
        ) : entries.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>Hakuna record bado</Text>
            <Text style={styles.emptyText}>Kila mzigo unaochukuliwa store utaonekana hapa pamoja na muda.</Text>
          </View>
        ) : (
          entries.map((entry) => (
            <View key={entry.id} style={styles.entryCard}>
              <View style={styles.entryTop}>
                <View style={styles.entryInfo}>
                  <Text style={styles.entryProduct}>{entry.product_name || entry.products?.name || 'Bidhaa'}</Text>
                  <Text style={styles.entryMeta}>
                    {movementTypeLabel(entry.movement_type)} · {statusLabel(entry.status)}
                  </Text>
                  <Text style={styles.entryMeta}>
                    Amechukua: {entry.person_name} · {formatDateTime(entry.created_at)}
                  </Text>
                </View>
                <View style={[styles.qtyBadge, entry.status === 'rejected' && styles.rejectedBadge]}>
                  <Text style={styles.qtyText}>
                    {formatQuantity(Number(entry.quantity))} {entry.unit ?? entry.products?.unit ?? 'pcs'}
                  </Text>
                </View>
              </View>
              <Text style={styles.recordedBy}>
                Aliyerekodi: {entry.profiles?.full_name ?? profile?.full_name ?? 'Mtumiaji'}
              </Text>
              {entry.approved_at ? (
                <Text style={styles.recordedBy}>
                  {entry.status === 'rejected' ? 'Alikataa' : 'Alithibitisha'}: {formatDateTime(entry.approved_at)}
                </Text>
              ) : null}
              {entry.note ? <Text style={styles.noteText}>{entry.note}</Text> : null}
              {isAdmin && (entry.status ?? 'pending') === 'pending' ? (
                <View style={styles.approvalActions}>
                  <Pressable style={styles.approveButton} onPress={() => approveEntry(entry, 'approved')}>
                    <Text style={styles.approveButtonText}>Thibitisha</Text>
                  </Pressable>
                  <Pressable style={styles.rejectButton} onPress={() => approveEntry(entry, 'rejected')}>
                    <Text style={styles.rejectButtonText}>Kataa</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          ))
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingBottom: 140,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  title: {
    color: Colors.text,
    fontSize: 24,
    fontWeight: '600',
  },
  subtitle: {
    color: Colors.textMuted,
    fontSize: 15,
    fontWeight: '400',
    marginTop: 4,
  },
  refreshButton: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    backgroundColor: Colors.primarySoft,
  },
  refreshText: {
    color: Colors.primary,
    fontWeight: '400',
  },
  summaryGrid: {
    flexDirection: 'row',
    gap: Spacing.md,
    marginBottom: Spacing.lg,
  },
  summaryCard: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
  },
  summaryLabel: {
    color: Colors.textMuted,
    fontSize: 13,
    fontWeight: '500',
  },
  summaryValue: {
    color: Colors.text,
    fontSize: 24,
    fontWeight: '600',
    marginTop: 4,
  },
  formCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.xl,
  },
  sectionTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '600',
    marginBottom: Spacing.md,
  },
  fieldLabel: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '500',
    marginBottom: Spacing.xs,
  },
  typeGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
    marginBottom: Spacing.lg,
  },
  typeChip: {
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  typeChipActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primarySoft,
  },
  typeChipText: {
    color: Colors.textMuted,
    fontWeight: '600',
    fontSize: 13,
  },
  typeChipTextActive: {
    color: Colors.primary,
  },
  error: {
    color: Colors.danger,
    fontWeight: '600',
    marginBottom: Spacing.md,
  },
  notice: {
    color: Colors.primary,
    fontWeight: '400',
    marginBottom: Spacing.md,
  },
  listHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: Spacing.md,
  },
  metaText: {
    color: Colors.textMuted,
    fontWeight: '400',
  },
  loading: {
    padding: Spacing.xl,
    alignItems: 'center',
  },
  emptyCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.lg,
    padding: Spacing.xl,
  },
  emptyTitle: {
    color: Colors.text,
    fontSize: 18,
    fontWeight: '600',
  },
  emptyText: {
    color: Colors.textMuted,
    marginTop: Spacing.xs,
    lineHeight: 20,
  },
  entryCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
  },
  entryTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  entryInfo: {
    flex: 1,
  },
  entryProduct: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: '600',
  },
  entryMeta: {
    color: Colors.textMuted,
    fontWeight: '400',
    marginTop: 4,
    lineHeight: 20,
  },
  qtyBadge: {
    backgroundColor: Colors.primarySoft,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  rejectedBadge: {
    backgroundColor: '#FEE2E2',
  },
  qtyText: {
    color: Colors.primary,
    fontWeight: '600',
  },
  recordedBy: {
    color: Colors.textMuted,
    fontWeight: '600',
    marginTop: Spacing.md,
  },
  noteText: {
    color: Colors.text,
    marginTop: Spacing.sm,
    lineHeight: 20,
  },
  approvalActions: {
    flexDirection: 'row',
    gap: Spacing.sm,
    marginTop: Spacing.md,
  },
  approveButton: {
    flex: 1,
    backgroundColor: Colors.primary,
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  rejectButton: {
    flex: 1,
    backgroundColor: '#FEE2E2',
    borderRadius: Radius.md,
    paddingVertical: Spacing.md,
    alignItems: 'center',
  },
  approveButtonText: {
    color: Colors.white,
    fontWeight: '600',
  },
  rejectButtonText: {
    color: Colors.danger,
    fontWeight: '600',
  },
});
