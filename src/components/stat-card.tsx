import { StyleSheet, Text, View } from 'react-native';

import { Colors, Radius, Spacing } from '@/constants/colors';

export function StatCard({
  label,
  value,
  tone = 'default',
}: {
  label: string;
  value: string;
  tone?: 'default' | 'danger' | 'success' | 'warning';
}) {
  return (
    <View style={[styles.card, toneStyles[tone]]}>
      <Text style={[styles.value, valueToneStyles[tone]]}>{value}</Text>
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: Colors.surface,
    borderRadius: Radius.lg,
    padding: Spacing.md,
    borderWidth: 1,
    borderColor: Colors.border,
    minHeight: 88,
    justifyContent: 'center',
    shadowColor: Colors.primaryDark,
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 4,
  },
  value: {
    fontSize: 20,
    fontWeight: '600',
    color: Colors.text,
  },
  label: {
    fontSize: 12,
    fontWeight: '500',
    color: Colors.textMuted,
    marginTop: Spacing.xs,
  },
});

const toneStyles = {
  default: {},
  danger: { backgroundColor: '#FFF6F7', borderColor: '#F4C4CB' },
  success: { backgroundColor: '#F2FFF8', borderColor: '#BFE8DA' },
  warning: { backgroundColor: Colors.warningSoft, borderColor: '#F6D89B' },
};

const valueToneStyles = {
  default: {},
  danger: { color: Colors.danger },
  success: { color: Colors.success },
  warning: { color: '#A46100' },
};
