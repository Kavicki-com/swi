import { useCallback, useEffect, useState } from 'react';
import { Alert, View } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Icon, Input, JourneyTheme, Title, useTheme } from '@kavicki/swi-design-system';
import { ReportDetailState } from '../../../../components/reports/ReportsListState';
import { useReports } from '../../../../services/reports/ReportsProvider';
import { useField } from '../../../../lib/forms/useField';
import { validateRequired } from '../../../../lib/validation/validators';
import { errorMessage } from '../../../../lib/errors/errorMessage';
import {
  ReportPermissionError,
  ReportVersionConflictError,
} from '../../../../services/reports/types';

// Edição de relatório. Espelha o formulário de `new.tsx` nos três campos de
// texto; anexos e responsáveis ficam para o ticket 16.
//
// O relatório não tem histórico de versões: salvar por cima é definitivo. Por
// isso o form carrega `version` junto com o texto e a devolve como
// `baseVersion` no PATCH. Se outra pessoa salvou nesse meio tempo, o servidor
// responde 409 e a tela oferece recarregar em vez de sobrescrever.
//
// Status e statusLabel NÃO aparecem aqui: são o veredito do ciclo de revisão,
// ato de ADMIN no painel. O tipo `ReportUpdateInput` já os exclui, e o servidor
// recusa com 403 quem tentar mandá-los mesmo assim.

type FormStatus = 'loading' | 'ready' | 'empty' | 'error';

// Resumo e detalhes são opcionais no backend (só o título é obrigatório na
// criação), então aqui eles também não travam o salvar.
const semValidacao = () => ({ valid: true });

export default function EditarRelatorio() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { loadOne, update } = useReports();

  const [status, setStatus] = useState<FormStatus>('loading');
  const [baseVersion, setBaseVersion] = useState(0);
  const [salvando, setSalvando] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const titulo = useField({ validator: (v) => validateRequired(v, 'Título') });
  const resumo = useField({ validator: semValidacao });
  const detalhes = useField({ validator: semValidacao });

  const { setValue: setTitulo } = titulo;
  const { setValue: setResumo } = resumo;
  const { setValue: setDetalhes } = detalhes;

  useEffect(() => {
    let ativo = true;
    if (!id) {
      setStatus('empty');
      return () => {
        ativo = false;
      };
    }
    setStatus('loading');
    loadOne(id)
      .then((r) => {
        if (!ativo) return;
        if (!r) {
          setStatus('empty');
          return;
        }
        setTitulo(r.title);
        setResumo(r.summary);
        setDetalhes(r.details);
        setBaseVersion(r.version);
        setStatus('ready');
      })
      .catch(() => {
        if (ativo) setStatus('error');
      });
    return () => {
      ativo = false;
    };
  }, [id, loadOne, reloadKey, setTitulo, setResumo, setDetalhes]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  // Recarrega SÓ a versão de referência, preservando o que a pessoa digitou.
  // Reescrever os campos com o texto do servidor apagaria o trabalho dela, que
  // é exatamente o que o aviso de conflito veio evitar.
  const adotarVersaoDoServidor = useCallback(async () => {
    if (!id) return;
    try {
      const atual = await loadOne(id);
      if (atual) setBaseVersion(atual.version);
    } catch {
      // Sem rede agora: a versão antiga continua valendo e o próximo salvar
      // volta a dar conflito, que é o desfecho honesto.
    }
  }, [id, loadOne]);

  const salvar = async () => {
    if (!id) return;
    if (!titulo.isValid) {
      titulo.setTouched(true);
      return;
    }
    setSalvando(true);
    try {
      await update(id, {
        title: titulo.value,
        summary: resumo.value,
        details: detalhes.value,
        baseVersion,
      });
      router.back();
    } catch (e) {
      // Recusa NÃO tira a pessoa do formulário: o texto dela continua na tela.
      if (e instanceof ReportVersionConflictError) {
        Alert.alert('Conflito de versão', e.message, [
          { text: 'Continuar editando', style: 'cancel' },
          { text: 'Recarregar', onPress: adotarVersaoDoServidor },
        ]);
      } else if (e instanceof ReportPermissionError) {
        Alert.alert('Sem permissão', e.message);
      } else {
        Alert.alert('Erro', errorMessage(e, 'Não foi possível salvar as alterações.'));
      }
    } finally {
      setSalvando(false);
    }
  };

  if (status !== 'ready') {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        <JourneyTheme
          gradient={require('../../../../assets/login-bg.png')}
          pattern={require('../../../../assets/smartband-bg-pattern.png')}
        />
        <ReportDetailState kind={status} onRetry={status === 'error' ? retry : undefined} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <JourneyTheme
        gradient={require('../../../../assets/login-bg.png')}
        pattern={require('../../../../assets/smartband-bg-pattern.png')}
      />

      <KeyboardAwareScrollView
        style={{ flex: 1, backgroundColor: 'transparent' }}
        contentContainerStyle={{
          paddingTop: insets.top,
          paddingBottom: insets.bottom + theme.padding.l,
          paddingHorizontal: theme.padding.m,
          gap: theme.gap.m,
        }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        bottomOffset={60}
      >
        <View style={{ alignSelf: 'flex-start', marginLeft: -18 }}>
          <Button
            variant="ghost"
            label="Voltar"
            labelColor={theme.content.primaryLight}
            accessibilityLabel="Voltar"
            onPress={() => router.back()}
            iconLeft={
              <Icon
                name="keyboard_arrow_left"
                width={24}
                height={24}
                color={theme.content.primaryLight}
              />
            }
          />
        </View>

        <Title variant="title.s" color={theme.content.primary}>
          Editar relatório
        </Title>

        <Input
          {...titulo.bind()}
          label="Título do relatório"
          placeholder="Digite aqui o título do relatório"
        />
        <Input
          {...resumo.bind()}
          label="Resumo do relatório"
          placeholder="Digite aqui um resumo do seu relatório"
        />
        <Input
          {...detalhes.bind()}
          label="Detalhes do relatório"
          placeholder="Digite aqui o seu relatório"
          multiline
          numberOfLines={16}
        />

        <Button
          variant="contained"
          backgroundColor={theme.surface.primary}
          labelColor={theme.content.light}
          label={salvando ? 'Salvando…' : 'Salvar alterações'}
          elevation="lg"
          accessibilityLabel="Salvar alterações"
          disabled={salvando}
          onPress={salvar}
        />
        <Button
          variant="ghost"
          label="Cancelar"
          labelColor={theme.content.primaryLight}
          accessibilityLabel="Cancelar"
          onPress={() => router.back()}
        />
      </KeyboardAwareScrollView>
    </View>
  );
}
