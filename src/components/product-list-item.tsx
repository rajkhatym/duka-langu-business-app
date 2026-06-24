import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Badge } from '@/components/badge';
import { Colors, Radius, Spacing } from '@/constants/colors';
import { formatQuantity } from '@/lib/format';
import type { Product } from '@/types/database';

export function ProductListItem({ product, onPress }: { product: Product; onPress: () => void }) {
  const isLow = product.quantity <= product.reorder_level;
  const variants = [product.variant_size, product.variant_color, product.variant_weight]
    .filter(Boolean)
    .join(' / ');

  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.card, pressed && styles.pressed]}>
      <View style={styles.info}>
        <Text style={styles.name}>{product.name}</Text>
        <Text style={styles.meta}>
          {product.sku ? `SKU: ${product.sku} · ` : ''}
          {product.category ?? 'Hakuna jamii'}
          {variants ? ` · ${variants}` : ''}
          {product.warranty_months ? ` · Warranty ${product.warranty_months}m` : ''}
        </Text>
      </View>
      <View style={styles.qtyBlock}>
        <Text style={[styles.qty, isLow && styles.qtyLow]}>
          {formatQuantity(product.quantity)} {product.unit}
        </Text>
        {isLow ? <Badge label="Stock Pungufu" tone="danger" /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: 'rgba(216,233,225,0.95)',
    padding: Spacing.lg,
    marginBottom: Spacing.md,
    shadowColor: Colors.primaryDark,
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  pressed: {
    opacity: 0.7,
  },
  info: {
    flex: 1,
    marginRight: Spacing.md,
  },
  name: {
    fontSize: 17,
    fontWeight: '600',
    color: Colors.text,
  },
  meta: {
    fontSize: 13,
    color: Colors.textMuted,
    marginTop: 2,
    fontWeight: '400',
  },
  qtyBlock: {
    alignItems: 'flex-end',
    gap: Spacing.xs,
  },
  qty: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.primaryDark,
  },
  qtyLow: {
    color: Colors.danger,
  },
});
