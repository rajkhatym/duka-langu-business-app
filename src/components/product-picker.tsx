import { useMemo, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Colors, Radius, Spacing } from '@/constants/colors';
import type { Product } from '@/types/database';

interface ProductPickerProps {
  label: string;
  products: Product[];
  value: Product | null;
  onChange: (product: Product) => void;
}

export function ProductPicker({ label, products, value, onChange }: ProductPickerProps) {
  const [visible, setVisible] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return products;
    return products.filter(
      (p) => p.name.toLowerCase().includes(q) || (p.sku ?? '').toLowerCase().includes(q)
    );
  }, [products, search]);

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <Pressable style={styles.input} onPress={() => setVisible(true)}>
        <Text style={value ? styles.valueText : styles.placeholderText}>
          {value ? value.name : 'Chagua bidhaa...'}
        </Text>
      </Pressable>

      <Modal visible={visible} animationType="slide" onRequestClose={() => setVisible(false)}>
        <View style={styles.modal}>
          <Text style={styles.modalTitle}>Chagua Bidhaa</Text>
          <TextInput
            style={styles.search}
            placeholder="Tafuta bidhaa au SKU..."
            placeholderTextColor={Colors.textMuted}
            value={search}
            onChangeText={setSearch}
            autoFocus
          />
          <FlatList
            data={filtered}
            keyExtractor={(item) => item.id}
            renderItem={({ item }) => (
              <Pressable
                style={styles.option}
                onPress={() => {
                  onChange(item);
                  setSearch('');
                  setVisible(false);
                }}>
                <Text style={styles.optionName}>{item.name}</Text>
                <Text style={styles.optionMeta}>
                  {item.sku ? `${item.sku} · ` : ''}
                  {item.quantity} {item.unit} stoo
                </Text>
              </Pressable>
            )}
            ListEmptyComponent={<Text style={styles.empty}>Hakuna bidhaa zinazofanana</Text>}
          />
          <Pressable style={styles.closeButton} onPress={() => setVisible(false)}>
            <Text style={styles.closeText}>Funga</Text>
          </Pressable>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: Spacing.lg,
  },
  label: {
    fontSize: 14,
    fontWeight: '500',
    color: Colors.text,
    marginBottom: Spacing.xs,
  },
  input: {
    height: 48,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.surface,
    justifyContent: 'center',
  },
  valueText: {
    fontSize: 16,
    color: Colors.text,
  },
  placeholderText: {
    fontSize: 16,
    color: Colors.textMuted,
  },
  modal: {
    flex: 1,
    backgroundColor: Colors.background,
    paddingTop: 60,
    paddingHorizontal: Spacing.lg,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: Colors.text,
    marginBottom: Spacing.lg,
  },
  search: {
    height: 48,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: Radius.md,
    paddingHorizontal: Spacing.md,
    backgroundColor: Colors.surface,
    color: Colors.text,
    marginBottom: Spacing.md,
  },
  option: {
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  optionName: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
  },
  optionMeta: {
    fontSize: 13,
    color: Colors.textMuted,
    marginTop: 2,
  },
  empty: {
    textAlign: 'center',
    color: Colors.textMuted,
    marginTop: Spacing.xl,
  },
  closeButton: {
    paddingVertical: Spacing.lg,
    alignItems: 'center',
  },
  closeText: {
    color: Colors.primary,
    fontWeight: '600',
    fontSize: 16,
  },
});
