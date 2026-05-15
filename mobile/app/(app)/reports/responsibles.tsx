import { useState } from 'react';
import { Pressable, ScrollView, Text as RNText, View } from 'react-native';
import { Asset } from 'expo-asset';
import { Stack, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Avatar,
  Button,
  Checkbox,
  SearchInput,
  Title,
  useTheme,
} from '@kavicki/swi-design-system';

// Figma 364:18017 — responsables-modal (bottom-sheet) aberto a partir
// de /reports/new "Atribuir responsáveis". Title + helper text +
// SearchInput + 5 Admin Cards (Avatar + name/age + blood-type +
// Checkbox) + Cancelar + Continuar.
// Demo phase: useState pra selected set; sem persistência.

const avatarUri = Asset.fromModule(
  require('../../../assets/avatar-construction.png'),
).uri;

const ADMINS = [
  { id: 'elisa', name: 'Elisa Siqueira Jordão', age: 32, blood: 'O+' },
  { id: 'mathias', name: 'Mathias Campos S.', age: 32, blood: 'AB-' },
  { id: 'joao', name: 'João Soares Ribeiro', age: 32, blood: 'A+' },
  { id: 'pedro', name: 'Pedro Carvalho Lima', age: 28, blood: 'O-' },
  { id: 'rita', name: 'Rita Sampaio Almeida', age: 41, blood: 'B+' },
];

export default function ResponsiblesModal() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const close = () => router.back();

  return (
    <>
      <Stack.Screen
        options={{
          presentation: 'transparentModal',
          animation: 'slide_from_bottom',
        }}
      />

      <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' }}>
        <Pressable
          onPress={close}
          accessibilityLabel="Fechar"
          accessibilityRole="button"
          style={{ flex: 1 }}
        />

        <View
          style={{
            backgroundColor: theme.surface.standard,
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
            <RNText
              style={{
                fontFamily: theme.fontFamily.body,
                fontWeight: theme.fontWeight.regular,
                fontSize: theme.fontSize.m,
                color: theme.content.dark,
              }}
            >
              Atribua 1 ou mais responsáveis ao seu relatório, eles revisaram e farão comentários.
            </RNText>
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
                    <Avatar uri={avatarUri} size="xl" />
                    <View style={{ gap: theme.gap.xs, flex: 1 }}>
                      <RNText
                        style={{
                          fontFamily: theme.fontFamily.body,
                          fontWeight: theme.fontWeight.bold,
                          fontSize: theme.fontSize.m,
                          color: theme.content.dark,
                        }}
                        numberOfLines={1}
                      >
                        {admin.name}
                      </RNText>
                      <RNText
                        style={{
                          fontFamily: theme.fontFamily.body,
                          fontWeight: theme.fontWeight.regular,
                          fontSize: theme.fontSize.m,
                          color: theme.content.dark,
                        }}
                      >
                        {admin.age} anos
                      </RNText>
                      <RNText
                        style={{
                          fontFamily: theme.fontFamily.body,
                          fontWeight: theme.fontWeight.bold,
                          fontSize: theme.fontSize.ms,
                          color: theme.content.dark,
                        }}
                      >
                        {admin.blood}
                      </RNText>
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
              onPress={close}
            />
            <Button
              variant="contained"
              backgroundColor={theme.surface.primary}
              labelColor={theme.content.light}
              label="Continuar"
              elevation="lg"
              accessibilityLabel="Continuar"
              onPress={close}
            />
          </View>
        </View>
      </View>
    </>
  );
}
