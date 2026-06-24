import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Badge } from '@/components/badge';
import { Colors, Radius, Spacing } from '@/constants/colors';
import { formatDateTime, formatQuantity } from '@/lib/format';
import type { StockMovement } from '@/types/database';

export function MovementListItem({
  movement,
  onOpenProduct,
}: {
  movement: StockMovement;
  onOpenProduct?: () => void;
}) {
  const isIn = movement.type === 'IN';

  return (
    <Pressable style={styles.card} onPress={onOpenProduct} disabled={!onOpenProduct}>
      <View style={styles.info}>
        <Text style={styles.name}>{movement.products?.name ?? 'Bidhaa'}</Text>
        <Text style={styles.meta}>{formatDateTime(movement.created_at)}</Text>
        {movement.profiles?.full_name ? (
          <Text style={styles.meta}>Na: {movement.profiles.full_name}</Text>
        ) : null}
        {movement.note ? <Text style={styles.note}>{movement.note}</Text> : null}
        {onOpenProduct ? <Text style={styles.openHint}>Fungua bidhaa</Text> : null}
      </View>
      <View style={styles.qtyBlock}>
        <Badge label={isIn ? 'STOCK IN' : 'STOCK OUT'} tone={isIn ? 'success' : 'danger'} />
        <Text style={[styles.qty, isIn ? styles.qtyIn : styles.qtyOut]}>
          {isIn ? '+' : '-'}
          {formatQuantity(movement.quantity)} {movement.products?.unit ?? ''}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.lg,
    marginBottom: Spacing.md,
  },
  info: {
    flex: 1,
    marginRight: Spacing.md,
  },
  name: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
  },
  meta: {
    fontSize: 13,
    color: Colors.textMuted,
    marginTop: 2,
  },
  note: {
    fontSize: 13,
    color: Colors.text,
    marginTop: Spacing.xs,
    fontStyle: 'italic',
  },
  openHint: {
    color: Colors.primaryDark,
    fontSize: 12,
    fontWeight: '400',
    marginTop: Spacing.xs,
  },
  qtyBlock: {
    alignItems: 'flex-end',
    gap: Spacing.xs,
  },
  qty: {
    fontSize: 16,
    fontWeight: '600',
  },
  qtyIn: {
    color: Colors.success,
  },
  qtyOut: {
    color: Colors.danger,
  },
});
