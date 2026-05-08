import type { Meta, StoryObj } from '@storybook/react'
import { Placeholder } from './Placeholder'

const meta: Meta<typeof Placeholder> = {
  title: 'App/Placeholder',
  component: Placeholder,
}

export default meta

export const Default: StoryObj<typeof Placeholder> = {
  args: { label: 'sample-screen' },
}
