import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { MovementListItem } from '@/components/movement-list-item';
import { Screen } from '@/components/screen';
import { Colors, Radius, Spacing } from '@/constants/colors';
import { isAnyPreviewMode, isCashierPreviewMode, isManagerPreviewMode, isOwnerPreviewMode, useAuth } from '@/lib/auth-context';
import { useBranch } from '@/lib/branch-context';
import { formatMoney, formatQuantity } from '@/lib/format';
import { applyLocalProductOverrides, saveLocalProductOverride } from '@/lib/local-product-overrides';
import { getLocalStockMovements, removeLocalStockMovement } from '@/lib/local-stock-movements';
import { setupDemoProducts } from '@/lib/setup-wizard';
import { supabase } from '@/lib/supabase';
import type { MovementType, Product, StockMovement } from '@/types/database';

type Filter = 'ALL' | MovementType;
type PeriodFilter = 'TODAY' | 'WEEK' | 'MONTH' | 'ALL';

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

async function withTimeout<T>(promise: PromiseLike<T>, timeoutMs = 6000): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) => {
      setTimeout(() => reject(new Error('Request timeout')), timeoutMs);
    }),
  ]);
}

function csvCell(value: string | number | null | undefined) {
  const text = value == null ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function downloadCsv(filename: string, csv: string) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return false;

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.URL.revokeObjectURL(url);
  return true;
}

export default function MovementsScreen() {
  const { isAdmin, isOwner } = useAuth();
  const { selectedBranchId } = useBranch();
  const previewQuery = isOwnerPreviewMode()
    ? '?owner=preview'
    : isManagerPreviewMode()
      ? '?manager=preview'
      : isCashierPreviewMode()
        ? '?cashier=preview'
        : '';
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [filter, setFilter] = useState<Filter>('ALL');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('TODAY');

  const load = useCallback(async () => {
    try {
      const movementsQuery = supabase
        .from('stock_movements')
        .select('*, products(id,name,unit,sku), profiles(id,full_name)')
        .eq('branch_id', selectedBranchId)
        .order('created_at', { ascending: false })
        .limit(100);

      const productsQuery = supabase
        .from('products')
        .select('*')
        .eq('branch_id', selectedBranchId)
        .order('name');

      let [{ data, error }, { data: productData, error: productError }] = await withTimeout(
        Promise.all([movementsQuery, productsQuery])
      );

      if (error?.message.includes('branch_id')) {
        const fallback = await withTimeout(
          supabase
            .from('stock_movements')
            .select('*, products(id,name,unit,sku), profiles(id,full_name)')
            .order('created_at', { ascending: false })
            .limit(100)
        );
        data = fallback.data;
      }

      if (productError?.message.includes('branch_id')) {
        const fallback = await withTimeout(supabase.from('products').select('*').order('name'));
        productData = fallback.data;
      }

      const localMovements = isOwnerPreviewMode() ? await getLocalStockMovements(selectedBranchId) : [];
      const databaseMovements = (data as unknown as StockMovement[]) ?? [];
      const nextProducts = applyLocalProductOverrides((productData as Product[]) ?? []);
      const fallbackProducts = applyLocalProductOverrides(previewProducts(selectedBranchId));

      setMovements([...localMovements, ...databaseMovements]);
      setProducts(nextProducts.length > 0 || !isAnyPreviewMode() ? nextProducts : fallbackProducts);
    } catch {
      const localMovements = isOwnerPreviewMode() ? await getLocalStockMovements(selectedBranchId) : [];
      setMovements(localMovements);
      setProducts(isAnyPreviewMode() ? applyLocalProductOverrides(previewProducts(selectedBranchId)) : []);
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

  const periodMovements = useMemo(() => {
    if (periodFilter === 'ALL') return movements;

    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);

    if (periodFilter === 'WEEK') {
      const day = start.getDay();
      const diffToMonday = day === 0 ? 6 : day - 1;
      start.setDate(start.getDate() - diffToMonday);
    }

    if (periodFilter === 'MONTH') {
      start.setDate(1);
    }

    return movements.filter((movement) => new Date(movement.created_at) >= start);
  }, [movements, periodFilter]);

  const filtered = useMemo(() => {
    const typeFiltered = filter === 'ALL' ? periodMovements : periodMovements.filter((m) => m.type === filter);
    const query = search.trim().toLowerCase();
    if (!query) return typeFiltered;

    return typeFiltered.filter((movement) => {
      const searchable = [
        movement.products?.name,
        movement.products?.sku,
        movement.products?.unit,
        movement.note,
        movement.type,
        movement.profiles?.full_name,
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return searchable.includes(query);
    });
  }, [periodMovements, filter, search]);
  const movementSummary = useMemo(() => {
    const todayKey = new Date().toDateString();
    return periodMovements.reduce(
      (acc, movement) => {
        if (movement.type === 'IN') {
          acc.stockIn += movement.quantity;
        } else {
          acc.stockOut += movement.quantity;
        }

        if (new Date(movement.created_at).toDateString() === todayKey) {
          acc.todayCount += 1;
          if (movement.type === 'IN') {
            acc.todayIn += movement.quantity;
          } else {
            acc.todayOut += movement.quantity;
          }
        }

        return acc;
      },
      { stockIn: 0, stockOut: 0, todayCount: 0, todayIn: 0, todayOut: 0 }
    );
  }, [periodMovements]);
  const netMovement = movementSummary.stockIn - movementSummary.stockOut;
  const todayNetMovement = movementSummary.todayIn - movementSummary.todayOut;
  const stockHealth = useMemo(() => {
    const lowStockProducts = products
      .filter((product) => product.quantity <= product.reorder_level)
      .sort((a, b) => a.quantity - a.reorder_level - (b.quantity - b.reorder_level));
    const outOfStockProducts = products.filter((product) => product.quantity <= 0);
    const costValue = products.reduce(
      (sum, product) => sum + product.quantity * (product.cost_price ?? 0),
      0
    );
    const sellingValue = products.reduce(
      (sum, product) => sum + product.quantity * (product.unit_price ?? 0),
      0
    );

    return {
      lowStockProducts,
      outOfStockCount: outOfStockProducts.length,
      costValue,
      sellingValue,
      potentialMargin: sellingValue - costValue,
    };
  }, [products]);
  const lowStockCount = stockHealth.lowStockProducts.length;
  const stockPreview = useMemo(() => products.slice(0, 8), [products]);
  const latestLocalMovement = useMemo(
    () => movements.find((movement) => movement.id.startsWith('local-movement-')) ?? null,
    [movements]
  );

  const undoLatestLocalMovement = async () => {
    if (!latestLocalMovement) return;
    const product = products.find((nextProduct) => nextProduct.id === latestLocalMovement.product_id);
    if (!product) {
      setNotice('Bidhaa ya movement hii haijapatikana.');
      return;
    }

    const restoredQuantity =
      latestLocalMovement.type === 'IN'
        ? Math.max(0, product.quantity - latestLocalMovement.quantity)
        : product.quantity + latestLocalMovement.quantity;

    saveLocalProductOverride(product.id, { quantity: restoredQuantity });
    await removeLocalStockMovement(latestLocalMovement.id);
    setNotice(`Movement imefutwa. Stock ya ${product.name} imerudishwa.`);
    await load();
  };

  const exportFilteredMovements = () => {
    if (filtered.length === 0) {
      setNotice('Hakuna movements za ku-export kwa filter hii.');
      return;
    }

    const header = ['date', 'type', 'product', 'sku', 'quantity', 'unit', 'note', 'branch_id', 'created_by'];
    const rows = filtered.map((movement) => [
      movement.created_at,
      movement.type,
      movement.products?.name ?? 'Bidhaa',
      movement.products?.sku ?? '',
      movement.quantity,
      movement.products?.unit ?? '',
      movement.note ?? '',
      movement.branch_id ?? selectedBranchId,
      movement.profiles?.full_name ?? movement.created_by ?? '',
    ]);
    const csv = [header, ...rows].map((row) => row.map(csvCell).join(',')).join('\n');
    const exported = downloadCsv(`stock-movements-${new Date().toISOString().slice(0, 10)}.csv`, csv);
    setNotice(exported ? `CSV imeandaliwa: ${filtered.length} movements.` : 'Export CSV inapatikana kwenye web preview.');
  };

  return (
    <Screen>
      <View style={styles.toolbar}>
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        <View style={styles.filters}>
          <FilterButton label="Zote" active={filter === 'ALL'} onPress={() => setFilter('ALL')} />
          <FilterButton label="Stock In" active={filter === 'IN'} onPress={() => setFilter('IN')} />
          <FilterButton label="Stock Out" active={filter === 'OUT'} onPress={() => setFilter('OUT')} />
        </View>
        <View style={styles.filters}>
          <FilterButton label="Leo" active={periodFilter === 'TODAY'} onPress={() => setPeriodFilter('TODAY')} />
          <FilterButton label="Wiki hii" active={periodFilter === 'WEEK'} onPress={() => setPeriodFilter('WEEK')} />
          <FilterButton label="Mwezi huu" active={periodFilter === 'MONTH'} onPress={() => setPeriodFilter('MONTH')} />
          <FilterButton label="Zote" active={periodFilter === 'ALL'} onPress={() => setPeriodFilter('ALL')} />
        </View>
        <View style={styles.actions}>
          <Pressable
            style={styles.secondaryButton}
            onPress={() => router.push(`/(tabs)/movements/log-book${previewQuery}` as Href)}>
            <Text style={styles.secondaryButtonText}>Store Log Book</Text>
          </Pressable>
        </View>
        {isAdmin ? (
          <View style={styles.actions}>
            {isOwner ? (
              <>
                <Pressable style={styles.secondaryButton} onPress={() => router.push('/(tabs)/products/new')}>
                  <Text style={styles.secondaryButtonText}>+ Bidhaa</Text>
                </Pressable>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => router.push('/(tabs)/movements/purchase' as Href)}>
                  <Text style={styles.secondaryButtonText}>Purchase</Text>
                </Pressable>
              </>
            ) : null}
            <Pressable
              style={styles.secondaryButton}
              onPress={() => router.push(`/(tabs)/movements/transfer${previewQuery}` as Href)}>
              <Text style={styles.secondaryButtonText}>Transfer</Text>
            </Pressable>
            {isOwner ? (
              <>
                <Pressable
                  style={styles.secondaryButton}
                  onPress={() => router.push('/(tabs)/movements/stock-count' as Href)}>
                  <Text style={styles.secondaryButtonText}>Count</Text>
                </Pressable>
                <Pressable style={styles.addButton} onPress={() => router.push('/(tabs)/movements/new')}>
                  <Text style={styles.addButtonText}>+ Stock</Text>
                </Pressable>
              </>
            ) : null}
          </View>
        ) : null}
        {isOwner ? (
          <Pressable
            style={styles.approvalButton}
            onPress={() => router.push('/(tabs)/movements/approvals' as Href)}>
            <Text style={styles.approvalButtonText}>Stock Adjustment Approvals</Text>
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
          ListHeaderComponent={
            <View style={styles.stockCard}>
              <View style={styles.stockTop}>
                <View>
                  <Text style={styles.stockTitle}>Stock Iliyopo</Text>
                  <Text style={styles.stockSubtitle}>{products.length} aina za bidhaa kwenye branch hii</Text>
                </View>
                <Pressable style={styles.viewStockButton} onPress={() => router.push('/(tabs)/products')}>
                  <Text style={styles.viewStockText}>Tazama zote</Text>
                </Pressable>
              </View>
              <View style={styles.stockStats}>
                <View style={styles.stockStat}>
                  <Text style={styles.stockStatValue}>{products.length}</Text>
                  <Text style={styles.stockStatLabel}>Bidhaa</Text>
                </View>
                <View style={styles.stockStat}>
                  <Text style={[styles.stockStatValue, lowStockCount > 0 && styles.lowValue]}>{lowStockCount}</Text>
                  <Text style={styles.stockStatLabel}>Stock pungufu</Text>
                </View>
                <View style={styles.stockStat}>
                  <Text style={[styles.stockStatValue, stockHealth.outOfStockCount > 0 && styles.lowValue]}>
                    {stockHealth.outOfStockCount}
                  </Text>
                  <Text style={styles.stockStatLabel}>Zimeisha</Text>
                </View>
              </View>
              {isOwner ? (
                <View style={styles.valuePanel}>
                  <View>
                    <Text style={styles.valueLabel}>Stock value kwa manunuzi</Text>
                    <Text style={styles.valueAmount}>Tsh {formatMoney(stockHealth.costValue)}</Text>
                  </View>
                  <View style={styles.valueDivider} />
                  <View>
                    <Text style={styles.valueLabel}>Potential margin</Text>
                    <Text style={styles.marginAmount}>Tsh {formatMoney(stockHealth.potentialMargin)}</Text>
                  </View>
                </View>
              ) : null}
              {stockPreview.length === 0 ? (
                <Text style={styles.stockEmpty}>Hakuna bidhaa kwenye branch hii bado.</Text>
              ) : (
                <View style={styles.stockRows}>
                  {stockPreview.map((product) => {
                    const isLow = product.quantity <= product.reorder_level;
                    return (
                      <Pressable
                        key={product.id}
                        style={styles.stockRow}
                        onPress={() => router.push(`/(tabs)/products/${product.id}`)}>
                        <View style={styles.stockInfo}>
                          <Text style={styles.stockName}>{product.name}</Text>
                          <Text style={styles.stockMeta}>{product.sku ?? product.category ?? 'Hakuna SKU'}</Text>
                        </View>
                        <Text style={[styles.stockQty, isLow && styles.lowValue]}>
                          {formatQuantity(product.quantity)} {product.unit}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
              {stockHealth.lowStockProducts.length > 0 ? (
                <View style={styles.alertPanel}>
                  <View style={styles.alertTop}>
                    <View>
                      <Text style={styles.alertTitle}>Low Stock Alerts</Text>
                      <Text style={styles.alertSubtitle}>Bidhaa zinazohitaji kununuliwa mapema.</Text>
                    </View>
                    {isOwner ? (
                      <Pressable
                        style={styles.purchaseButton}
                        onPress={() => router.push('/(tabs)/movements/purchase' as Href)}>
                        <Text style={styles.purchaseButtonText}>Purchase</Text>
                      </Pressable>
                    ) : null}
                  </View>
                  {stockHealth.lowStockProducts.slice(0, 5).map((product) => (
                    <View key={`alert-${product.id}`} style={styles.alertRow}>
                      <View style={styles.stockInfo}>
                        <Pressable onPress={() => router.push(`/(tabs)/products/${product.id}`)}>
                          <Text style={styles.stockName}>{product.name}</Text>
                        </Pressable>
                        <Text style={styles.stockMeta}>
                          {product.sku ?? product.category ?? 'Hakuna SKU'} | Reorder: {formatQuantity(product.reorder_level)}
                        </Text>
                      </View>
                      <View style={styles.alertActionBlock}>
                        <Text style={[styles.stockQty, styles.lowValue]}>
                          {formatQuantity(product.quantity)} {product.unit}
                        </Text>
                        {isOwner ? (
                          <Pressable
                            style={styles.restockAlertButton}
                            onPress={() =>
                              router.push(
                                `/(tabs)/movements/new?productId=${product.id}&type=IN&qty=${Math.max(
                                  product.reorder_level - product.quantity,
                                  1
                                )}${isOwnerPreviewMode() ? '&owner=preview' : ''}` as Href
                              )
                            }>
                            <Text style={styles.restockAlertText}>Ongeza</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    </View>
                  ))}
                </View>
              ) : (
                <View style={styles.safePanel}>
                  <Text style={styles.safeTitle}>Stock iko sawa</Text>
                  <Text style={styles.safeText}>Hakuna bidhaa iliyo chini ya reorder level kwa sasa.</Text>
                </View>
              )}
              <View style={styles.movementSummaryPanel}>
                <View style={styles.summaryTop}>
                  <View>
                    <Text style={styles.summaryTitle}>Muhtasari wa movements</Text>
                    <Text style={styles.summarySubtitle}>Stock In/Out kulingana na kipindi ulichochagua</Text>
                  </View>
                </View>
                <View style={styles.summaryGrid}>
                  <View style={styles.summaryCard}>
                    <Text style={styles.summaryLabel}>Stock In</Text>
                    <Text style={styles.summaryInValue}>+{formatQuantity(movementSummary.stockIn)}</Text>
                  </View>
                  <View style={styles.summaryCard}>
                    <Text style={styles.summaryLabel}>Stock Out</Text>
                    <Text style={styles.summaryOutValue}>-{formatQuantity(movementSummary.stockOut)}</Text>
                  </View>
                  <View style={styles.summaryCard}>
                    <Text style={styles.summaryLabel}>Net</Text>
                    <Text style={[styles.summaryValue, netMovement < 0 && styles.summaryOutValue]}>
                      {netMovement >= 0 ? '+' : ''}
                      {formatQuantity(netMovement)}
                    </Text>
                  </View>
                  <View style={styles.summaryCard}>
                    <Text style={styles.summaryLabel}>Leo</Text>
                    <Text style={[styles.summaryValue, todayNetMovement < 0 && styles.summaryOutValue]}>
                      {movementSummary.todayCount} move · {todayNetMovement >= 0 ? '+' : ''}
                      {formatQuantity(todayNetMovement)}
                    </Text>
                  </View>
                </View>
              </View>
              <View style={styles.searchPanel}>
                <Text style={styles.searchLabel}>Tafuta movement</Text>
                <View style={styles.searchRow}>
                  <TextInput
                    value={search}
                    onChangeText={setSearch}
                    placeholder="Jina, SKU, note..."
                    placeholderTextColor={Colors.textMuted}
                    style={styles.searchInput}
                  />
                  {search ? (
                    <Pressable style={styles.clearSearchButton} onPress={() => setSearch('')}>
                      <Text style={styles.clearSearchText}>Clear</Text>
                    </Pressable>
                  ) : null}
                </View>
                {search ? (
                  <Text style={styles.searchResultText}>
                    Matokeo: {filtered.length} kati ya {periodMovements.length}
                  </Text>
                ) : null}
                <View style={styles.exportRow}>
                  <Text style={styles.exportHint}>{filtered.length} movements zimechaguliwa</Text>
                  <Pressable style={styles.exportButton} onPress={exportFilteredMovements}>
                    <Text style={styles.exportButtonText}>Export CSV</Text>
                  </Pressable>
                </View>
              </View>
              <Text style={styles.movementTitle}>Historia ya Stock In/Out</Text>
              {isOwnerPreviewMode() && latestLocalMovement ? (
                <View style={styles.undoPanel}>
                  <View style={styles.undoInfo}>
                    <Text style={styles.undoTitle}>Movement ya mwisho inaweza kurudishwa</Text>
                    <Text style={styles.undoText}>
                      {latestLocalMovement.type === 'IN' ? '+' : '-'}
                      {formatQuantity(latestLocalMovement.quantity)} {latestLocalMovement.products?.unit ?? ''} -{' '}
                      {latestLocalMovement.products?.name ?? 'Bidhaa'}
                    </Text>
                  </View>
                  <Pressable style={styles.undoButton} onPress={undoLatestLocalMovement}>
                    <Text style={styles.undoButtonText}>Undo</Text>
                  </Pressable>
                </View>
              ) : null}
            </View>
          }
          renderItem={({ item }) => (
            <MovementListItem
              movement={item}
              onOpenProduct={() =>
                router.push(
                  `/(tabs)/products/${item.product_id}${isOwnerPreviewMode() ? '?owner=preview' : ''}` as Href
                )
              }
            />
          )}
          ListEmptyComponent={
            <EmptyState
              title="Hakuna mzunguko wa stock"
              subtitle={isOwner ? "Bonyeza '+ Bidhaa' kuongeza bidhaa mpya au '+ Stock' kurekodi bidhaa zinazoingia/kutoka." : 'Historia ya stock itaonekana hapa.'}
            />
          }
        />
      )}
    </Screen>
  );
}

function FilterButton({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.filterButton, active && styles.filterButtonActive]}
      onPress={onPress}>
      <Text style={[styles.filterText, active && styles.filterTextActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    gap: Spacing.md,
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
  },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.xs,
  },
  actions: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  notice: {
    color: Colors.primaryDark,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    borderRadius: Radius.md,
    padding: Spacing.md,
    fontSize: 12,
    fontWeight: '400',
  },
  filterButton: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.pill,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  filterButtonActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  filterText: {
    fontSize: 13,
    color: Colors.textMuted,
    fontWeight: '400',
  },
  filterTextActive: {
    color: Colors.white,
  },
  addButton: {
    flex: 1,
    height: 40,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonText: {
    color: Colors.white,
    fontWeight: '600',
    fontSize: 13,
  },
  secondaryButton: {
    flex: 1,
    height: 40,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: {
    color: Colors.primaryDark,
    fontWeight: '600',
    fontSize: 13,
  },
  approvalButton: {
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.warning,
    alignItems: 'center',
    justifyContent: 'center',
  },
  approvalButtonText: {
    color: Colors.warning,
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
  stockCard: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.lg,
    gap: Spacing.md,
  },
  stockTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  stockTitle: {
    color: Colors.text,
    fontSize: 17,
    fontWeight: '600',
  },
  stockSubtitle: {
    color: Colors.textMuted,
    marginTop: 2,
  },
  viewStockButton: {
    minHeight: 36,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  viewStockText: {
    color: Colors.primaryDark,
    fontWeight: '400',
  },
  stockStats: {
    flexDirection: 'row',
    gap: Spacing.sm,
  },
  stockStat: {
    flex: 1,
    backgroundColor: Colors.background,
    borderRadius: Radius.md,
    padding: Spacing.md,
  },
  stockStatValue: {
    color: Colors.primaryDark,
    fontSize: 20,
    fontWeight: '600',
  },
  stockStatLabel: {
    color: Colors.textMuted,
    marginTop: 2,
    fontSize: 12,
    fontWeight: '500',
  },
  lowValue: {
    color: Colors.danger,
  },
  valuePanel: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
    backgroundColor: Colors.primarySoft,
    borderRadius: Radius.md,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: '#BFE5D6',
  },
  valueLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  valueAmount: {
    color: Colors.primaryDark,
    fontSize: 17,
    fontWeight: '600',
    marginTop: 2,
  },
  marginAmount: {
    color: Colors.success,
    fontSize: 17,
    fontWeight: '600',
    marginTop: 2,
  },
  valueDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: '#BFE5D6',
  },
  stockRows: {
    gap: Spacing.xs,
  },
  stockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 46,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    gap: Spacing.md,
  },
  stockInfo: {
    flex: 1,
  },
  stockName: {
    color: Colors.text,
    fontWeight: '600',
  },
  stockMeta: {
    color: Colors.textMuted,
    fontSize: 12,
    marginTop: 1,
  },
  stockQty: {
    color: Colors.text,
    fontWeight: '600',
  },
  stockEmpty: {
    color: Colors.textMuted,
  },
  alertPanel: {
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: '#F5C2C7',
    backgroundColor: '#FFF5F5',
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  alertTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    marginBottom: Spacing.xs,
  },
  alertTitle: {
    color: Colors.danger,
    fontWeight: '600',
    fontSize: 15,
  },
  alertSubtitle: {
    color: Colors.textMuted,
    fontSize: 12,
    marginTop: 1,
  },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 44,
    borderTopWidth: 1,
    borderTopColor: '#F5C2C7',
    gap: Spacing.md,
  },
  alertActionBlock: {
    alignItems: 'flex-end',
    gap: Spacing.xs,
  },
  restockAlertButton: {
    minHeight: 30,
    borderRadius: Radius.md,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.sm,
  },
  restockAlertText: {
    color: Colors.white,
    fontSize: 12,
    fontWeight: '400',
  },
  purchaseButton: {
    minHeight: 34,
    paddingHorizontal: Spacing.md,
    borderRadius: Radius.md,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  purchaseButtonText: {
    color: Colors.white,
    fontSize: 12,
    fontWeight: '600',
  },
  safePanel: {
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    backgroundColor: '#F2FBF7',
    padding: Spacing.md,
  },
  safeTitle: {
    color: Colors.primaryDark,
    fontWeight: '600',
  },
  safeText: {
    color: Colors.textMuted,
    marginTop: 2,
    fontSize: 12,
  },
  movementSummaryPanel: {
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
    padding: Spacing.md,
    gap: Spacing.md,
  },
  summaryTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  summaryTitle: {
    color: Colors.text,
    fontSize: 14,
    fontWeight: '600',
  },
  summarySubtitle: {
    color: Colors.textMuted,
    fontSize: 12,
    marginTop: 2,
  },
  summaryGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: Spacing.sm,
  },
  summaryCard: {
    flexGrow: 1,
    minWidth: '47%',
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    padding: Spacing.md,
  },
  summaryLabel: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '500',
  },
  summaryValue: {
    color: Colors.primaryDark,
    fontSize: 18,
    fontWeight: '600',
    marginTop: 2,
  },
  summaryInValue: {
    color: Colors.success,
    fontSize: 18,
    fontWeight: '600',
    marginTop: 2,
  },
  summaryOutValue: {
    color: Colors.danger,
    fontSize: 18,
    fontWeight: '600',
    marginTop: 2,
  },
  searchPanel: {
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.surface,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  searchLabel: {
    color: Colors.text,
    fontSize: 13,
    fontWeight: '500',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
  },
  searchInput: {
    flex: 1,
    minHeight: 44,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    backgroundColor: Colors.background,
    color: Colors.text,
    paddingHorizontal: Spacing.md,
    fontSize: 15,
  },
  clearSearchButton: {
    minHeight: 44,
    borderRadius: Radius.md,
    backgroundColor: Colors.primarySoft,
    borderWidth: 1,
    borderColor: '#BFE5D6',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  clearSearchText: {
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '600',
  },
  searchResultText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
  },
  exportRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    paddingTop: Spacing.sm,
  },
  exportHint: {
    flex: 1,
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '400',
  },
  exportButton: {
    minHeight: 38,
    borderRadius: Radius.md,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  exportButtonText: {
    color: Colors.white,
    fontSize: 12,
    fontWeight: '600',
  },
  movementTitle: {
    color: Colors.text,
    fontWeight: '600',
    marginTop: Spacing.xs,
  },
  undoPanel: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: Spacing.md,
    borderWidth: 1,
    borderColor: '#F5C2C7',
    borderRadius: Radius.md,
    backgroundColor: '#FFF5F5',
    padding: Spacing.md,
  },
  undoInfo: {
    flex: 1,
  },
  undoTitle: {
    color: Colors.danger,
    fontWeight: '600',
  },
  undoText: {
    color: Colors.textMuted,
    fontSize: 12,
    fontWeight: '600',
    marginTop: 2,
  },
  undoButton: {
    minHeight: 36,
    borderRadius: Radius.md,
    backgroundColor: Colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.md,
  },
  undoButtonText: {
    color: Colors.white,
    fontSize: 12,
    fontWeight: '600',
  },
});
