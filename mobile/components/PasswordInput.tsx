import { useState } from 'react';
import { Pressable } from 'react-native';
import { Icon, Input, useTheme } from '@kavicki/swi-design-system';

// Shared password input. Wraps DS Input with the visibility toggle pattern
// that was previously duplicated in sign-up.tsx, password-recovery/new-password.tsx,
// and settings/change-password.tsx (~20 lines per usage, ~60 total). Each
// instance keeps its own `visible` state so multiple password fields on the
// same screen toggle independently.
//
// Icon size 22 matches the auth-flow inputs (sign-up / new-password); the
// previous change-password copy used size 24 — unified at 22 since the DS
// doesn't ship a settings-specific size, and the difference was incidental.

// DS Input descriptionVariant union: 'default' | 'success' | 'error' | 'warning'
// (verified in node_modules/.../Input/Input.types.ts). The only call site that
// uses descriptionVariant today is 'success' (the "senhas iguais ✓" hint), but
// narrowing to the full DS union keeps the wrapper from clipping future uses.
export interface PasswordInputProps {
  label: string;
  /** Weight of the label text. Forwarded to DS Input.labelWeight. Defaults to `'bold'`. */
  labelWeight?: 'regular' | 'medium' | 'bold';
  placeholder?: string;
  value: string;
  onChangeText: (text: string) => void;
  description?: string;
  descriptionVariant?: 'default' | 'success' | 'error' | 'warning';
}

export function PasswordInput({
  label,
  labelWeight,
  placeholder,
  value,
  onChangeText,
  description,
  descriptionVariant,
}: PasswordInputProps) {
  const theme = useTheme();
  const [visible, setVisible] = useState(false);

  return (
    <Input
      label={label}
      labelWeight={labelWeight}
      placeholder={placeholder}
      value={value}
      onChangeText={onChangeText}
      secureTextEntry={!visible}
      autoCapitalize="none"
      autoCorrect={false}
      description={description}
      descriptionVariant={descriptionVariant}
      iconRight={
        <Pressable
          onPress={() => setVisible((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel={visible ? 'Ocultar senha' : 'Mostrar senha'}
          hitSlop={8}
        >
          <Icon
            name={visible ? 'visibility_off' : 'visibility'}
            size={22}
            color={theme.content.dark}
          />
        </Pressable>
      }
    />
  );
}
