// src/components/VisibilityToggle.tsx
import { Pressable } from 'react-native'
import { useTheme } from '@kavicki/swi-design-system'

export function VisibilityToggle({ on, onToggle }: { on: boolean; onToggle: () => void }) {
  const theme = useTheme()
  const color = theme.content.dark
  return (
    <Pressable
      onPress={onToggle}
      accessibilityRole="button"
      accessibilityLabel={on ? 'Esconder senha' : 'Mostrar senha'}
      style={{ padding: 4 }}
    >
      {on ? (
        // eye-off (visibility_off)
        <svg width={22} height={22} viewBox="0 -960 960 960" fill={color} aria-hidden="true">
          <path d="M644-428 532-540q12-7 24.5-9.5T580-552q42 0 71 29t29 71q0 12-2.5 24.5T668-403L644-428Zm114 114L646-426q11-19 17.5-41t6.5-45q0-79-55.5-134.5T480-702q-23 0-44.5 5.5T393-680l-86-86q42-18 86-26t87-8q146 0 263 81.5T912-510q-21 56-58 102.5T758-314Zm46 258L658-202q-37 14-79.5 22T480-172q-148 0-264.5-82T48-462q21-50 56.5-94.5T184-642L60-768l44-46 740 740-40 18ZM240-580q-30 25-55.5 56.5T144-462q34 80 132 138t204 58q31 0 60-3.5t60-12.5l-39-37q-19 5-37.5 7.5T480-308q-79 0-134.5-55.5T290-498q0-12 1.5-24t6.5-24l-58-34Zm285 116Zm-99-44Z" />
        </svg>
      ) : (
        // eye (visibility)
        <svg width={22} height={22} viewBox="0 -960 960 960" fill={color} aria-hidden="true">
          <path d="M480-320q75 0 127.5-52.5T660-500q0-75-52.5-127.5T480-680q-75 0-127.5 52.5T300-500q0 75 52.5 127.5T480-320Zm0-72q-45 0-76.5-31.5T372-500q0-45 31.5-76.5T480-608q45 0 76.5 31.5T588-500q0 45-31.5 76.5T480-392Zm0 192q-146 0-266-81.5T48-500q46-137 166-218.5T480-800q146 0 266 81.5T912-500q-46 137-166 218.5T480-200Zm0-300Zm0 220q113 0 207.5-59.5T832-500q-50-101-144.5-160.5T480-720q-113 0-207.5 59.5T128-500q50 101 144.5 160.5T480-280Z" />
        </svg>
      )}
    </Pressable>
  )
}
