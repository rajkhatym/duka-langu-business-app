import { SymbolView } from 'expo-symbols';
import type { SFSymbol } from 'sf-symbols-typescript';
import { StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';

import { Colors } from '@/constants/colors';

export type AppIconName = {
  ios: SFSymbol;
  android: string;
  web: string;
};

export function AppIcon({
  name,
  fallback,
  color = Colors.textMuted,
  size = 22,
  style,
  fallbackStyle,
}: {
  name: AppIconName;
  fallback: string;
  color?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
  fallbackStyle?: StyleProp<TextStyle>;
}) {
  return (
    <View style={[styles.box, { width: size + 4, height: size + 4 }, style]}>
      <SymbolView
        name={name as never}
        size={size}
        tintColor={color}
        resizeMode="scaleAspectFit"
        fallback={
          <Text style={[styles.fallback, { color, fontSize: size, lineHeight: size + 2 }, fallbackStyle]}>
            {fallback}
          </Text>
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallback: {
    fontWeight: '600',
    textAlign: 'center',
  },
});
