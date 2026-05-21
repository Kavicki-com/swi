import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Asset } from 'expo-asset';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Avatar,
  Button,
  Checkbox,
  Icon,
  SearchInput,
  Text,
  Title,
  useTheme,
} from '@kavicki/swi-design-system';
import { ADMINS } from '../../lib/admins';

// Figma 364:18017 — bottom-sheet "Selecionar responsáveis".
// Body compartilhado; até agora só `(app)/reports/responsibles.tsx`
// usa este modal (chamado de `reports/new.tsx`). A stub
// `app/modals/responsables.tsx` é dead code (zero callers).

// Demo-phase selection store. expo-router não propaga params via
// `router.back()`, então o "hand-off" da seleção ao caller acontece
// via este módulo singleton. `reports/responsibles.tsx` chama
// `responsiblesSelection.set(...)` antes de fechar; `reports/new.tsx`
// lê via `useFocusEffect` ao reentrar. Phase 2: substituir por um
// store real (zustand/jotai) ou query-cache.
//
// `ADMINS` foi extraído pra `lib/admins.ts` (audit cleanup 2026-05-17)
// pra separar mock data da UI; o singleton de seleção fica aqui por
// estar tightly coupled ao confirm flow do modal.

let _selectedIds: string[] = [];
export const responsiblesSelection = {
  get(): string[] {
    return _selectedIds.slice();
  },
  set(ids: string[]): void {
    _selectedIds = ids.slice();
  },
  clear(): void {
    _selectedIds = [];
  },
};

const avatarUri = Asset.fromModule(
  require('../../assets/avatar-construction.png'),
).uri;

interface ResponsiblesModalProps {
  onClose: () => void;
  // Confirma a seleção. Demo phase: o caller só fecha; futuramente
  // recebe o array de ids escolhidos para hidratar `reports/new`.
  onConfirm?: (selectedIds: string[]) => void;
}

export function ResponsiblesModal({ onClose, onConfirm }: ResponsiblesModalProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleConfirm = () => {
    onConfirm?.(Array.from(selected));
    onClose();
  };

  return (
    <View
      style={{
        // Figma 364:18017 mostra modal um tom mais claro que o conteúdo
        // dentro (SearchInput + admin cards usam standard mais escuro).
        // Usar surface.medium garante contraste visível pro SearchInput.
        backgroundColor: theme.surface.medium,
        paddingTop: theme.padding.m,
        paddingHorizontal: theme.padding.m,
        paddingBottom: insets.bottom + theme.padding.m,
        borderTopLeftRadius: theme.border.radius.m,
        borderTopRightRadius: theme.border.radius.m,
        gap: theme.gap.l,
        maxHeight: '85%',
      }}
    >
      <View style={{ gap: theme.gap.s }}>
        <Title variant="title.xs" color={theme.content.dark}>
          Selecionar responsáveis
        </Title>
        <Text variant="body.m" color={theme.content.dark}>
          Atribua 1 ou mais responsáveis ao seu relatório, eles revisaram e farão comentários.
        </Text>
      </View>

      <SearchInput
        value={search}
        onChangeText={setSearch}
        placeholder="Pesquisar"
      />

      <ScrollView
        style={{ flexGrow: 0 }}
        contentContainerStyle={{ gap: theme.gap.s }}
        showsVerticalScrollIndicator={false}
      >
        {ADMINS.map((admin) => {
          const isChecked = selected.has(admin.id);
          return (
            <Pressable
              key={admin.id}
              onPress={() => toggle(admin.id)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isChecked }}
              accessibilityLabel={admin.name}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'space-between',
                backgroundColor: theme.background,
                borderRadius: theme.border.radius.m,
                paddingHorizontal: theme.padding.m,
                paddingVertical: theme.padding.s,
              }}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s, flex: 1 }}>
                <Avatar uri={avatarUri} size="l" />
                <View style={{ gap: theme.gap.xs, flex: 1 }}>
                  <Text
                    variant="body.m"
                    weight="bold"
                    color={theme.content.dark}
                    numberOfLines={1}
                  >
                    {admin.name}
                  </Text>
                  <Text variant="body.m" color={theme.content.dark}>
                    {admin.age} anos
                  </Text>
                  {/* Figma 364:18017 mostra blood type com water_drop icon
                      vermelho à esquerda (theme.surface.error). */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.xs }}>
                    <Icon name="water_drop" size={20} color={theme.surface.error} />
                    <Text variant="label.l" color={theme.content.dark}>
                      {admin.blood}
                    </Text>
                  </View>
                </View>
              </View>
              <Checkbox
                checked={isChecked}
                onChange={() => toggle(admin.id)}
                accessibilityLabel={`Selecionar ${admin.name}`}
              />
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={{ gap: theme.gap.sm }}>
        <Button
          variant="outline"
          borderColor={theme.content.primaryLight}
          labelColor={theme.content.primaryLight}
          label="Cancelar"
          accessibilityLabel="Cancelar"
          onPress={onClose}
        />
        <Button
          variant="contained"
          backgroundColor={theme.surface.primary}
          labelColor={theme.content.light}
          label="Continuar"
          elevation="lg"
          accessibilityLabel="Continuar"
          onPress={handleConfirm}
        />
      </View>
    </View>
  );
}
