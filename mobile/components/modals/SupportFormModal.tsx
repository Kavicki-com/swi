import { useState } from 'react';
import { Alert, Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { KeyboardStickyView } from 'react-native-keyboard-controller';
import { createSupportRequest } from '../../services/api/support';
import { useSubmitOnce } from '../../lib/forms/useSubmitOnce';
import { errorMessage } from '../../lib/errors/errorMessage';
import {
  Button,
  Combobox,
  Icon,
  Input,
  Title,
  useTheme,
} from '@kavicki/swi-design-system';

// Body compartilhado entre `(app)/settings/support.tsx` (authenticated)
// e `modals/support-form.tsx` (acessível também da tela de login).
// Os wrappers de rota injetam o backdrop transparent + envelope do
// Stack.Screen; este componente cuida só do conteúdo do sheet.

interface SupportFormModalProps {
  onClose: () => void;
}

export function SupportFormModal({ onClose }: SupportFormModalProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [motivo, setMotivo] = useState('');
  const [titulo, setTitulo] = useState('');
  const [mensagem, setMensagem] = useState('');

  // O combo vinha com `options={[]}` — impossivel de preencher, e `reason` e
  // obrigatorio no backend (1-120). Lista provisoria: cobre os motivos que o
  // suporte recebe hoje. Se o cliente tiver taxonomia propria, vira catalogo
  // no backend, como jobTitles/sectors.
  const MOTIVOS = [
    'Problema para acessar a conta',
    'Erro no aplicativo',
    'Duvida sobre uma tarefa',
    'Problema com a smartband',
    'Outro assunto',
  ].map((m) => ({ label: m, value: m }));

  const podeEnviar =
    motivo.length > 0 && titulo.trim().length > 0 && mensagem.trim().length > 0;

  // DESCARTAVA tudo. Nao havia rota chamada em lugar nenhum — enquanto o
  // backend (POST /support) ja existia, com um DTO que espelha estes campos.
  // Formulario que finge ter enviado e pior que formulario ausente.
  const enviarSolicitacao = async () => {
    if (!podeEnviar) return;
    try {
      await createSupportRequest({
        reason: motivo,
        title: titulo.trim(),
        message: mensagem.trim(),
      });
      Alert.alert('Solicitacao enviada', 'Nossa equipe vai responder em breve.');
      onClose();
    } catch (e) {
      // O motivo real do servidor importa aqui: o throttle e de 5/min, e um
      // "tente de novo" generico deixaria a pessoa repetindo sem entender.
      Alert.alert('Erro', errorMessage(e, 'Nao foi possivel enviar a solicitacao.'));
    }
  };
  const { run: enviar, busy: enviando } = useSubmitOnce(enviarSolicitacao);

  return (
    // Bottom-sheet: o teclado cobria Título e Mensagem. KeyboardStickyView
    // eleva o sheet acima do teclado (mesmo tratamento do ResponsiblesModal).
    <KeyboardStickyView>
    <View
      style={{
        backgroundColor: theme.background,
        paddingTop: theme.padding.m,
        paddingHorizontal: theme.padding.m,
        paddingBottom: insets.bottom + theme.padding.xl,
        borderTopLeftRadius: theme.border.radius.l,
        borderTopRightRadius: theme.border.radius.l,
        gap: theme.gap.m,
      }}
    >
      {/* Header: title + close icon */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.m }}>
        <View style={{ flex: 1 }}>
          <Title variant="title.xs" color={theme.content.primary}>
            Solicitação de suporte
          </Title>
        </View>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Fechar"
        >
          <Icon name="close" size={24} color={theme.content.dark} />
        </Pressable>
      </View>

      <Combobox
        label="Motivo da solicitação"
        placeholder="Selecione aqui"
        options={MOTIVOS}
        value={motivo}
        onChange={setMotivo}
      />

      <Input
        label="Título da sua solicitação"
        placeholder="Digite aqui"
        value={titulo}
        onChangeText={setTitulo}
      />

      <Input
        label="Mensagem"
        placeholder="Digite aqui a sua mensagem"
        value={mensagem}
        onChangeText={setMensagem}
        multiline
        numberOfLines={5}
      />

      <Button
        variant="contained"
        backgroundColor={theme.surface.primary}
        labelColor={theme.content.light}
        label={enviando ? 'Enviando…' : 'Enviar solicitação'}
        elevation="lg"
        accessibilityLabel="Enviar solicitação"
        disabled={!podeEnviar || enviando}
        onPress={enviar}
      />
    </View>
    </KeyboardStickyView>
  );
}
