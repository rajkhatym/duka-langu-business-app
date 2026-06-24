import { StyleSheet, Text, View } from 'react-native';

import { Colors, Radius, Spacing } from '@/constants/colors';

type Tone = 'success' | 'danger' | 'warning' | 'neutral';

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: Tone }) {
  return (
    <View style={[styles.badge, toneStyles[tone].badge]}>
      <Text style={[styles.label, toneStyles[tone].label]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.pill,
    alignSelf: 'flex-start',
  },
  label: {
    fontSize: 12,
    fontWeight: '500',
  },
});

const toneStyles: Record<Tone, { badge: object; label: object }> = {
  success: { badge: { backgroundColor: '#E6F4EA' }, label: { color: Colors.success } },
  danger: { badge: { backgroundColor: '#FCE8E6' }, label: { color: Colors.danger } },
  warning: { badge: { backgroundColor: '#FFF1E0' }, label: { color: Colors.warning } },
  neutral: { badge: { backgroundColor: Colors.border }, label: { color: Colors.textMuted } },
};
