import { router, useFocusEffect, type Href } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';
import { StatCard } from '@/components/stat-card';
import { Colors, Radius, Spacing } from '@/constants/colors';
import { useBranch } from '@/lib/branch-context';
import { formatDateTime, formatMoney, formatQuantity } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import type { Sale } from '@/types/database';

function saleTotal(sale: Sale) {
  return sale.quantity * sale.unit_price;
}

function saleBalance(sale: Sale) {
  return Math.max(saleTotal(sale) - sale.amount_paid, 0);
}

function paymentMethodLabel(method: Sale['payment_method']) {
  if (method === 'mpesa') return 'M-Pesa';
  if (method === 'bank') return 'Bank';
  if (method === 'credit') return 'Credit';
  return 'Cash';
}

function saleNumber(sale: Sale) {
  return sale.sale_number ?? sale.id.slice(0, 8).toUpperCase();
}

function startOfDay(date: Date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function SalesScreen() {
  const { selectedBranchId } = useBranch();
  const [sales, setSales] = useState<Sale[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase
      .from('sales')
      .select('*, products(id,name,unit,sku)')
      .eq('branch_id', selectedBranchId)
      .order('created_at', { ascending: false })
      .limit(100);
    setSales((data as unknown as Sale[]) ?? []);
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

  const today = startOfDay(new Date());
  const todaySales = sales.filter((sale) => new Date(sale.created_at) >= today);
  const todayTotal = todaySales.reduce((sum, sale) => sum + saleTotal(sale), 0);
  const todayPaid = todaySales.reduce((sum, sale) => sum + sale.amount_paid, 0);
  const debtTotal = sales.reduce((sum, sale) => sum + saleBalance(sale), 0);

  return (
    <Screen>
      <View style={styles.toolbar}>
        <View style={styles.stats}>
          <View style={styles.statsRow}>
            <StatCard label="Mauzo Leo" value={`Tsh ${formatMoney(todayTotal)}`} />
            <StatCard label="Malipo Leo" value={`Tsh ${formatMoney(todayPaid)}`} />
          </View>
          <View style={styles.statsRow}>
            <StatCard label="Madeni ya Mauzo" value={`Tsh ${formatMoney(debtTotal)}`} tone="danger" />
            <StatCard label="Receipt Leo" value={String(todaySales.length)} />
          </View>
        </View>
        <Pressable style={styles.addButton} onPress={() => router.push('/(tabs)/sales/new' as Href)}>
          <Text style={styles.addButtonText}>+ Uza</Text>
        </Pressable>
      </View>

      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={sales}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshing={refreshing}
          onRefresh={onRefresh}
          renderItem={({ item }) => <SaleRow sale={item} />}
          ListEmptyComponent={
            <EmptyState title="Hakuna mauzo bado" subtitle="Bonyeza '+ Uza' kurekodi mauzo ya kwanza." />
          }
        />
      )}
    </Screen>
  );
}

function SaleRow({ sale }: { sale: Sale }) {
  const balance = saleBalance(sale);

  return (
    <View style={styles.row}>
      <View style={styles.rowTop}>
        <Text style={styles.product}>{sale.products?.name ?? 'Bidhaa'}</Text>
        <Text style={styles.amount}>Tsh {formatMoney(saleTotal(sale))}</Text>
      </View>
      <Text style={styles.meta}>
        {formatQuantity(sale.quantity)} {sale.products?.unit ?? ''} x Tsh {formatMoney(sale.unit_price)}
      </Text>
      <Text style={styles.saleNumber}>{saleNumber(sale)}</Text>
      <Text style={styles.meta}>
        {paymentMethodLabel(sale.payment_method)}: Tsh {formatMoney(sale.amount_paid)}
        {balance > 0 ? ` | Deni: Tsh ${formatMoney(balance)}` : ''}
      </Text>
      <Text style={styles.date}>
        {sale.customer_name ? `${sale.customer_name} | ` : ''}
        {formatDateTime(sale.created_at)}
      </Text>
      <Pressable
        style={styles.receiptButton}
        onPress={() => router.push(`/(tabs)/sales/receipt?id=${sale.id}` as Href)}>
        <Text style={styles.receiptText}>Receipt / Invoice</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  toolbar: {
    paddingTop: Spacing.lg,
    paddingBottom: Spacing.md,
    gap: Spacing.md,
  },
  stats: {
    gap: Spacing.md,
  },
  statsRow: {
    flexDirection: 'row',
    gap: Spacing.md,
  },
  addButton: {
    height: 44,
    borderRadius: Radius.md,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addButtonText: {
    color: Colors.white,
    fontWeight: '600',
    fontSize: 15,
  },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  list: {
    paddingBottom: Spacing.xxl,
  },
  row: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
  },
  rowTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: Spacing.md,
  },
  product: {
    flex: 1,
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
  },
  amount: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.success,
  },
  meta: {
    color: Colors.textMuted,
    marginTop: Spacing.xs,
  },
  saleNumber: {
    alignSelf: 'flex-start',
    marginTop: Spacing.xs,
    borderRadius: Radius.sm,
    backgroundColor: Colors.primarySoft,
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: Spacing.sm,
    paddingVertical: 3,
  },
  date: {
    color: Colors.textMuted,
    fontSize: 12,
    marginTop: Spacing.sm,
  },
  receiptButton: {
    alignSelf: 'flex-start',
    marginTop: Spacing.md,
    borderRadius: Radius.sm,
    backgroundColor: Colors.primarySoft,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
  },
  receiptText: {
    color: Colors.primaryDark,
    fontWeight: '400',
  },
});
