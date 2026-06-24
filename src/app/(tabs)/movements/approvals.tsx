import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';

import { EmptyState } from '@/components/empty-state';
import { Screen } from '@/components/screen';
import { Colors, Radius, Spacing } from '@/constants/colors';
import { useAuth } from '@/lib/auth-context';
import { useBranch } from '@/lib/branch-context';
import { formatDateTime, formatQuantity } from '@/lib/format';
import { supabase } from '@/lib/supabase';
import type { StockAdjustmentRequest } from '@/types/database';

export default function StockApprovalsScreen() {
  const { session, isOwner } = useAuth();
  const { selectedBranchId } = useBranch();
  const [requests, setRequests] = useState<StockAdjustmentRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    let query = supabase
      .from('stock_adjustment_requests')
      .select('*, products(id,name,unit,sku,quantity)')
      .eq('status', 'pending')
      .order('created_at', { ascending: false });

    if (!isOwner) query = query.eq('branch_id', selectedBranchId);

    const { data } = await query;
    setRequests((data as unknown as StockAdjustmentRequest[]) ?? []);
  }, [isOwner, selectedBranchId]);

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

  const review = async (request: StockAdjustmentRequest, status: 'approved' | 'rejected') => {
    if (status === 'rejected') {
      await updateStatus(request, status);
      return;
    }

    Alert.alert('Approve adjustment', 'Unaruhusu stock ibadilishwe kwa kiasi hiki?', [
      { text: 'Ghairi', style: 'cancel' },
      {
        text: 'Approve',
        onPress: async () => {
          const movementType = request.requested_quantity >= 0 ? 'IN' : 'OUT';
          const movementQuantity = Math.abs(request.requested_quantity);
          const { error: movementError } = await supabase.from('stock_movements').insert({
            branch_id: request.branch_id,
            product_id: request.product_id,
            type: movementType,
            quantity: movementQuantity,
            note: `Approved stock adjustment: ${request.reason ?? ''}`,
            created_by: session?.user.id,
          });

          if (movementError) {
            Alert.alert('Hitilafu', movementError.message);
            return;
          }

          await updateStatus(request, 'approved');
        },
      },
    ]);
  };

  const updateStatus = async (request: StockAdjustmentRequest, status: 'approved' | 'rejected') => {
    const { error } = await supabase
      .from('stock_adjustment_requests')
      .update({
        status,
        reviewed_by: session?.user.id,
        reviewed_at: new Date().toISOString(),
      })
      .eq('id', request.id);

    if (error) {
      Alert.alert('Hitilafu', error.message);
      return;
    }
    await load();
  };

  return (
    <Screen>
      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <FlatList
          data={requests}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <ApprovalRow
              request={item}
              canReview={isOwner}
              onApprove={() => review(item, 'approved')}
              onReject={() => review(item, 'rejected')}
            />
          )}
          ListEmptyComponent={<EmptyState title="Hakuna approval pending" />}
        />
      )}
    </Screen>
  );
}

function ApprovalRow({
  request,
  canReview,
  onApprove,
  onReject,
}: {
  request: StockAdjustmentRequest;
  canReview: boolean;
  onApprove: () => void;
  onReject: () => void;
}) {
  const unit = request.products?.unit ?? '';
  return (
    <View style={styles.card}>
      <View style={styles.rowTop}>
        <Text style={styles.product}>{request.products?.name ?? 'Bidhaa'}</Text>
        <Text style={[styles.qty, request.requested_quantity < 0 && styles.dangerText]}>
          {formatQuantity(request.requested_quantity)} {unit}
        </Text>
      </View>
      <Text style={styles.meta}>System stock: {formatQuantity(request.products?.quantity ?? 0)} {unit}</Text>
      <Text style={styles.meta}>{request.reason ?? 'Bila sababu'}</Text>
      <Text style={styles.date}>{formatDateTime(request.created_at)}</Text>
      {canReview ? (
        <View style={styles.actions}>
          <Pressable style={styles.rejectButton} onPress={onReject}>
            <Text style={styles.rejectText}>Reject</Text>
          </Pressable>
          <Pressable style={styles.approveButton} onPress={onApprove}>
            <Text style={styles.approveText}>Approve</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingTop: Spacing.lg, paddingBottom: Spacing.xxl },
  card: {
    backgroundColor: Colors.surface,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    padding: Spacing.md,
    marginBottom: Spacing.md,
    gap: Spacing.xs,
  },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', gap: Spacing.md },
  product: { flex: 1, color: Colors.text, fontSize: 16, fontWeight: '600' },
  qty: { color: Colors.success, fontWeight: '600' },
  meta: { color: Colors.textMuted, fontWeight: '400' },
  date: { color: Colors.textMuted, fontSize: 12 },
  actions: { flexDirection: 'row', gap: Spacing.md, marginTop: Spacing.md },
  rejectButton: {
    flex: 1,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: '#FDECEA',
    alignItems: 'center',
    justifyContent: 'center',
  },
  approveButton: {
    flex: 1,
    height: 40,
    borderRadius: Radius.md,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rejectText: { color: Colors.danger, fontWeight: '600' },
  approveText: { color: Colors.white, fontWeight: '600' },
  dangerText: { color: Colors.danger },
});
