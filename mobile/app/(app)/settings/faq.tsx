import { useMemo, useState } from 'react';
import { Image as RNImage, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Accordion,
  Pagination,
  SearchInput,
  Title,
  TopBar,
  useTheme,
} from '@kavicki/swi-design-system';
import { HomeFAB } from '../../../components/HomeFAB';

// Accordions (collapsed por default) + Pagination + Home FAB. A busca filtra
// pergunta E resposta sem exigir acento, e a paginação fatia a lista
// filtrada em páginas de 6 (pageCount real; mudar a busca volta pra 1).
// para que o estado "expandido" do Accordion mostre conteúdo coerente.
const FAQS: { q: string; a: string }[] = [
  {
    q: 'Como faço para criar uma conta?',
    a: 'Na tela de login, toque em "Criar conta" e preencha seus dados pessoais. Após confirmar seu e-mail, complete os dados complementares e pareie sua smartband para concluir o cadastro.',
  },
  {
    q: 'Esqueci minha senha, o que fazer?',
    a: 'Na tela de login, toque em "Esqueci minha senha", informe seu e-mail cadastrado e siga o link enviado para definir uma nova senha.',
  },
  {
    q: 'Posso usar o aplicativo offline?',
    a: 'O aplicativo precisa de conexão para sincronizar dados de segurança, alertas e mapas em tempo real. Algumas telas ficam disponíveis em modo limitado quando o sinal cai.',
  },
  {
    q: 'Como atualizar meu perfil?',
    a: 'Acesse Configurações > Dados pessoais para editar seu nome, telefone e demais informações. Algumas alterações exigem reconfirmação por e-mail.',
  },
  {
    q: 'O aplicativo é gratuito?',
    a: 'O SWI é fornecido pela sua empresa como ferramenta de segurança operacional. Não há cobrança individual para o colaborador.',
  },
  {
    q: 'Como faço para cancelar minha assinatura?',
    a: 'A conta está vinculada ao contrato da sua empresa. Para encerrar o acesso, fale com o administrador responsável pela operação SWI.',
  },
  {
    q: 'O que fazer se o aplicativo travar?',
    a: 'Force o fechamento, abra novamente e verifique sua conexão. Se o problema persistir, envie um relato pela tela "Fale conosco" em Configurações.',
  },
  {
    q: 'Como ativar notificações?',
    a: 'Acesse Configurações > Preferências e mantenha as notificações habilitadas. Confirme também a permissão de notificações nas configurações do sistema do seu celular.',
  },
  {
    q: 'Posso sincronizar meus dados entre dispositivos?',
    a: 'Sim. Faça login com a mesma conta corporativa em outro dispositivo e seus dados de perfil e histórico ficam disponíveis automaticamente.',
  },
  {
    q: 'Como envio feedback ou reporto um problema?',
    a: 'Em Configurações > Fale conosco, escolha o tipo de mensagem (sugestão, dúvida, problema técnico) e descreva o ocorrido. Nosso time responde por e-mail.',
  },
  {
    q: 'O aplicativo suporta múltiplos idiomas?',
    a: 'No momento o SWI está disponível em Português (Brasil). Outros idiomas serão liberados conforme a operação da sua empresa.',
  },
  {
    q: 'Como proteger minha conta?',
    a: 'Use uma senha forte e exclusiva, não compartilhe seu login com colegas e mantenha o aplicativo sempre atualizado. Em caso de suspeita de acesso indevido, troque a senha imediatamente.',
  },
];

const PAGE_SIZE = 6;

// Busca tolerante: sem caixa e sem acento dos dois lados, senão "notificacoes"
// digitado num teclado apressado não acha "notificações".
const normaliza = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export default function SettingsFAQ() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  const filtradas = useMemo(() => {
    const q = normaliza(search.trim());
    if (!q) return FAQS;
    return FAQS.filter((f) => normaliza(`${f.q} ${f.a}`).includes(q));
  }, [search]);

  const pageCount = Math.max(1, Math.ceil(filtradas.length / PAGE_SIZE));
  // Clamp em vez de efeito: uma busca que encolhe a lista não pode deixar a
  // página apontando pro vazio.
  const pagina = Math.min(currentPage, pageCount);
  const visiveis = filtradas.slice((pagina - 1) * PAGE_SIZE, pagina * PAGE_SIZE);

  const aoBuscar = (texto: string) => {
    setSearch(texto);
    setCurrentPage(1);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View
        pointerEvents="none"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      >
        <RNImage
          source={require('../../../assets/login-bg.png')}
          resizeMode="cover"
          accessible={false}
          style={{ width: '100%', height: '100%' }}
        />
      </View>

      <ScrollView
        style={{ flex: 1, backgroundColor: 'transparent' }}
        contentContainerStyle={{
          paddingTop: insets.top,
          paddingBottom: insets.bottom + 120,
          paddingHorizontal: theme.padding.m,
        }}
        showsVerticalScrollIndicator={false}
      >
        <TopBar title="FAQ" onBack={() => router.back()} />

        <View
          style={{
            marginTop: theme.padding.sm,
            gap: 38,
          }}
        >
          <Title variant="title.xs" color={theme.content.dark}>
            Tire suas dúvidas com a nossa central de perguntas frequentes
          </Title>

          <SearchInput
            value={search}
            onChangeText={aoBuscar}
            placeholder="Pesquisar"
          />

          <View style={{ gap: theme.gap.sm }}>
            {visiveis.map(({ q, a }) => (
              <Accordion
                key={q}
                title={q}
                fullWidth
                showIconLeft={false}
              >
                {a}
              </Accordion>
            ))}

            <Pagination
              currentPage={pagina}
              pageCount={pageCount}
              onPageChange={setCurrentPage}
            />
          </View>
        </View>
      </ScrollView>

      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          bottom: insets.bottom + theme.gap.l,
          left: 0,
          right: 0,
          alignItems: 'center',
        }}
      >
        <HomeFAB onPress={() => router.push('/(app)/dashboard')} />
      </View>
    </View>
  );
}
