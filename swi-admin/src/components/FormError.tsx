// src/components/FormError.tsx
import { Text } from '@kavicki/swi-design-system'

export function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <Text testID="form-error" accessibilityRole="alert">
      {message}
    </Text>
  )
}
