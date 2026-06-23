import { Stack } from 'expo-router';
import { ChatProvider } from '../../../services/chat/ChatProvider';

export default function ChatLayout() {
  return (
    <ChatProvider>
      <Stack screenOptions={{ headerShown: false, animation: 'slide_from_right' }} />
    </ChatProvider>
  );
}
