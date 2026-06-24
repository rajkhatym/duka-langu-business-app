import { createElement, useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

import { Colors, Radius, Spacing } from '@/constants/colors';

type Variant = 'primary' | 'secondary' | 'danger';

interface ButtonProps {
  label: string;
  onPress: () => void;
  variant?: Variant;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function Button({
  label,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
}: ButtonProps) {
  const isDisabled = disabled || loading;
  const webButtonRef = useRef<HTMLElement | null>(null);
  const lastWebPressAt = useRef(0);
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;

  useEffect(() => {
    if (Platform.OS !== 'web') return undefined;
    const element = webButtonRef.current;
    if (!element) return undefined;

    const handler = (event: Event) => {
      event.preventDefault();
      if (isDisabled) return;

      const now = Date.now();
      if (now - lastWebPressAt.current < 350) return;
      lastWebPressAt.current = now;
      onPressRef.current();
    };
    const keyHandler = (event: KeyboardEvent) => {
      if (event.key === 'Enter' || event.key === ' ') handler(event);
    };

    element.addEventListener('click', handler);
    element.addEventListener('keydown', keyHandler);
    return () => {
      element.removeEventListener('click', handler);
      element.removeEventListener('keydown', keyHandler);
    };
  }, [isDisabled]);

  if (Platform.OS === 'web') {
    const webButtonStyle = StyleSheet.flatten([
      styles.base,
      variantStyles[variant],
      isDisabled && styles.disabled,
      style,
    ]) as Record<string, string | number>;
    const webLabelStyle = StyleSheet.flatten([
      styles.label,
      variant === 'secondary' && styles.labelSecondary,
    ]);

    return createElement(
      'button',
      {
        ref: webButtonRef,
        type: 'button',
        disabled: isDisabled,
        style: {
          ...webButtonStyle,
          borderStyle: webButtonStyle.borderWidth ? 'solid' : 'none',
          cursor: isDisabled ? 'not-allowed' : 'pointer',
          display: 'flex',
          fontFamily: 'inherit',
        },
      },
      createElement('span', { style: webLabelStyle }, loading ? '...' : label)
    );
  }

  return (
    <Pressable
      onPress={onPress}
      disabled={isDisabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.base,
        variantStyles[variant],
        isDisabled && styles.disabled,
        pressed && !isDisabled && styles.pressed,
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={variant === 'secondary' ? Colors.primary : Colors.white} />
      ) : (
        <Text style={[styles.label, variant === 'secondary' && styles.labelSecondary]}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    minHeight: 50,
    borderRadius: Radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing.lg,
    shadowColor: Colors.primaryDark,
    shadowOpacity: 0.16,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 9 },
    elevation: 5,
  },
  pressed: {
    opacity: 0.85,
  },
  disabled: {
    opacity: 0.5,
  },
  label: {
    color: Colors.white,
    fontSize: 16,
    fontWeight: '600',
  },
  labelSecondary: {
    color: Colors.primary,
  },
});

const variantStyles: Record<Variant, StyleProp<ViewStyle>> = {
  primary: { backgroundColor: Colors.primaryDark },
  danger: { backgroundColor: Colors.danger },
  secondary: {
    backgroundColor: '#F8FFFC',
    borderWidth: 1,
    borderColor: Colors.border,
    shadowOpacity: 0,
    elevation: 0,
  },
};
