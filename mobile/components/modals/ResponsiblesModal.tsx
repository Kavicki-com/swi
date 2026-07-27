import { useEffect, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
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
import { listReportAssignees } from '../../services/reports/assignees';
import type { Contact } from '../../services/chat/types';
import { ageFrom } from '../../lib/age';

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
// A lista vem do diretório REAL da empresa (/chat/directory, org-scoped, já
// carregado pelo ChatProvider). Antes eram 5 pessoas inventadas em
// lib/admins.ts — e o pior: `reports/new.tsx` resolvia id→nome por elas e
// GRAVAVA "Elisa Siqueira Jordão" como responsável no backend de verdade
// (QA 2026-07-26). O singleton de seleção fica aqui por estar acoplado ao
// confirm flow do modal.

// Guarda id E NOME. Guardando só id, quem exibe precisaria do diretório pra
// resolver o nome — foi o que derrubou a tela de novo relatório: ela chamava
// useChat() fora do ChatProvider (que só envolve a subárvore de chat) e morria
// na montagem. Com o nome aqui, a tela de relatório não depende de provider
// nenhum.
export interface ResponsiblePick {
  id: string;
  name: string;
}

let _selected: ResponsiblePick[] = [];
export const responsiblesSelection = {
  get(): ResponsiblePick[] {
    return _selected.slice();
  },
  set(picks: ResponsiblePick[]): void {
    _selected = picks.slice();
  },
  clear(): void {
    _selected = [];
  },
};

interface ResponsiblesModalProps {
  onClose: () => void;
  // Confirma a seleção. Demo phase: o caller só fecha; futuramente
  // recebe o array de ids escolhidos para hidratar `reports/new`.
  onConfirm?: (picks: ResponsiblePick[]) => void;
}

export function ResponsiblesModal({ onClose, onConfirm }: ResponsiblesModalProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Busca DIRETO do backend (a flag decide mock/api), sem useChat(): o
  // ChatProvider só envolve a subárvore de chat, e este modal vive na de
  // relatórios — consumir o contexto aqui derrubava a tela na montagem.
  //
  // Fonte trocada em 2026-07-27: era o diretório de CHAT, que devolve a
  // empresa inteira de propósito (sem os admins ali o worker não consegue
  // abrir conversa com o painel). O seletor acabava oferecendo os 10
  // operadores como revisores. Quem revisa é staff, e essa régua vive no
  // backend — /reports/assignees.
  const [directory, setDirectory] = useState<Contact[]>([]);
  useEffect(() => {
    let cancelled = false;
    void listReportAssignees()
      .then((list) => { if (!cancelled) setDirectory(list); })
      // Lista vazia já comunica "ninguém pra atribuir"; um alerta sobre isso
      // atrapalharia quem só quer escrever o relatório.
      .catch(() => undefined);
    return () => { cancelled = true; };
  }, []);

  // O SearchInput existia mas não filtrava nada — digitar não mudava a lista.
  const term = search.trim().toLowerCase();
  const people = term
    ? directory.filter((c) => c.name.toLowerCase().includes(term))
    : directory;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const handleConfirm = () => {
    // Devolve id + nome: o backend de relatórios guarda NOMES, e quem exibe
    // não deve precisar do diretório pra resolver.
    const picks = directory
      .filter((c) => selected.has(c.workerId))
      .map((c) => ({ id: c.workerId, name: c.name }));
    onConfirm?.(picks);
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
        {people.map((person) => {
          const isChecked = selected.has(person.workerId);
          const age = ageFrom(person.birthDate);
          return (
            <Pressable
              key={person.workerId}
              onPress={() => toggle(person.workerId)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: isChecked }}
              accessibilityLabel={person.name}
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
                <Avatar uri={person.avatarUri} name={person.name} size="l" />
                <View style={{ gap: theme.gap.xs, flex: 1 }}>
                  <Text
                    variant="body.m"
                    weight="bold"
                    color={theme.content.dark}
                    numberOfLines={1}
                  >
                    {person.name}
                  </Text>
                  <Text variant="body.m" color={theme.content.dark}>
                    {age !== null ? `${age} anos` : 'Idade não informada'}
                  </Text>
                  {/* Figma 364:18017 mostra blood type com water_drop icon
                      vermelho à esquerda (theme.surface.error). */}
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.xs }}>
                    <Icon name="water_drop" size={20} color={theme.surface.error} />
                    <Text variant="label.l" color={theme.content.dark}>
                      {person.bloodType ?? '—'}
                    </Text>
                  </View>
                </View>
              </View>
              <Checkbox
                checked={isChecked}
                onChange={() => toggle(person.workerId)}
                accessibilityLabel={`Selecionar ${person.name}`}
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
