import type { Preview } from '@storybook/react'
import { SwiThemeProvider } from '@kavicki/swi-design-system'

const preview: Preview = {
  decorators: [
    (Story) => (
      <SwiThemeProvider>
        <Story />
      </SwiThemeProvider>
    ),
  ],
}

export default preview
