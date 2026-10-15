// src/pages/user/components/PrivacyPolicyModal.tsx
// Modal de política de privacidade e termos de uso. Extraído de
// UserSettings.tsx sem mudança de comportamento.
import { Pressable, View } from 'react-native'
import { Icon, Text, Title, useTheme } from '@kavicki/swi-design-system'

const PRIVACY_POLICY_TEXT = `Política de Privacidade e Termos de Uso da plataforma SWI
Versão 1.0, 15 de outubro de 2026

1. Sobre este documento
O SWI é uma plataforma de segurança e saúde no trabalho, composta pelo aplicativo do trabalhador, pelo painel de administração e por um relógio inteligente pareado ao celular. Este documento explica quais dados pessoais o SWI trata, para quê, com quem são compartilhados, por quanto tempo ficam guardados e como você exerce seus direitos, nos termos da Lei Geral de Proteção de Dados Pessoais (Lei nº 13.709/2018, LGPD). Ele também traz as regras de uso da plataforma.

2. Quem trata os seus dados
A empresa empregadora que cadastrou você no SWI é a controladora dos seus dados: é ela quem decide usar a plataforma, define quem da equipe tem acesso e responde pelos pedidos dos titulares.
A Kavicki.com (Jorge Luis Silva Kavicki Cia Ltda, CNPJ 45.625.800/0001-36) desenvolveu a plataforma e opera a hospedagem. Ela atua como operadora, tratando os dados somente em nome da empresa empregadora e conforme as instruções dela.

3. Quais dados são tratados
a) Identificação e cadastro: nome completo, e-mail, nome de usuário, telefone, CPF, data de nascimento, endereço, foto de perfil, empresa, setor, cargo e função. A senha é guardada apenas em forma cifrada (hash), nunca em texto legível.
b) Dados de saúde informados no cadastro: gênero, tipo sanguíneo, altura, peso, alergias, doenças crônicas, deficiência e exames ocupacionais, com validade e arquivo anexo.
c) Localização: a posição do celular enquanto o aplicativo está aberto e, durante a jornada de trabalho, também em segundo plano, com leituras a cada poucos segundos. O envio em segundo plano começa com a jornada, termina com ela e é desligado automaticamente depois de 12 horas. No Android, uma notificação fixa avisa enquanto a localização está sendo enviada.
d) Sinais vitais do dispositivo vestível: frequência cardíaca, saturação de oxigênio, passos, distância, energia gasta, movimento e nível de bateria do relógio. Com a sua permissão no aparelho, o aplicativo também lê a pressão arterial e a temperatura corporal registradas no app Saúde do celular.
e) Esforço e fadiga: índices calculados pela plataforma a partir da frequência cardíaca, do movimento e da idade. Veja o item 6.
f) Chat: mensagens de texto e imagens trocadas na plataforma e as denúncias de mensagens.
g) Relatórios, tarefas e anexos: relatórios de ocorrência, tarefas da jornada e as fotos e arquivos anexados.
h) Transmissão da câmera: quando você aciona a transmissão, o vídeo da câmera do celular é enviado ao vivo, sem áudio.
i) Segurança e emergência: alertas de saúde, de clima e de bateria, avisos de perda de sinal, chamados de resgate e confirmações de presença em evacuações.
j) Dados técnicos: identificação do celular e do relógio pareado e registros de acesso e de funcionamento necessários à segurança da plataforma.

4. Para que os dados são usados
Os dados são usados para proteger a segurança e a saúde de quem trabalha: acompanhar em tempo real a localização e o estado de saúde da equipe; emitir alertas quando uma leitura indica risco; localizar e orientar o resgate de quem precisa de ajuda; conduzir evacuações; registrar ocorrências e tarefas; permitir a comunicação da equipe; e gerar estatísticas de saúde e segurança para a empresa empregadora. Também são usados para manter a sua conta, autenticar o acesso e proteger a plataforma contra uso indevido.
O SWI não usa os seus dados para publicidade e não os vende.

5. Bases legais
Os dados pessoais são tratados com base no cumprimento de obrigações legais e regulatórias de segurança e saúde no trabalho (art. 7º, II, da LGPD), na execução do contrato de trabalho (art. 7º, V), na proteção da vida e da incolumidade física (art. 7º, VII) e no legítimo interesse da empresa empregadora em manter a segurança das operações e da plataforma (art. 7º, IX).
Sinais vitais, esforço, fadiga, dados de saúde do cadastro e exames são dados pessoais sensíveis. Eles são tratados com base no cumprimento de obrigação legal ou regulatória (art. 11, II, "a") e na proteção da vida e da incolumidade física do titular ou de terceiros (art. 11, II, "e"). Quando a empresa empregadora adotar o consentimento para algum tratamento específico, você pode revogá-lo a qualquer momento, sem prejuízo do que já foi feito com base nele.
As permissões de localização, de câmera e de leitura de dados de saúde são concedidas por você nas configurações do celular e do relógio e podem ser retiradas por lá. Sem elas, as funções de segurança correspondentes deixam de funcionar.

6. Esforço e fadiga são estimativas
Os valores de esforço e fadiga mostrados no SWI são estimativas calculadas automaticamente a partir das leituras do relógio. Eles não são diagnóstico médico, não substituem a avaliação de um profissional de saúde e podem divergir do seu estado real. Os alertas gerados a partir deles servem para chamar a atenção da equipe responsável, que avalia cada caso; nenhum alerta bloqueia o seu trabalho automaticamente. Você pode pedir à empresa empregadora a revisão de decisões tomadas com base nesses cálculos (art. 20 da LGPD).

7. Quem vê os seus dados
a) Na empresa empregadora: as pessoas com perfil de administrador no SWI, como gestores, supervisores e a equipe de segurança do trabalho, veem o seu cadastro, a sua localização, o seu histórico de sinais vitais e de alertas, os relatórios e a transmissão da câmera quando você a aciona. Cada empresa enxerga apenas os dados de quem ela cadastrou.
b) Colegas da mesma empresa: no mapa do aplicativo, veem a sua posição recente e um indicador do seu estado de saúde (por exemplo, normal ou em alerta), para que possam ajudar em uma emergência. Também veem os relatórios de ocorrência da empresa.
c) Chat: as mensagens são vistas pelas pessoas que participam da conversa. Uma mensagem denunciada é enviada por e-mail ao endereço de suporte configurado na plataforma, com o conteúdo e a identificação de quem denunciou e de quem escreveu.
d) Transmissão da câmera: o vídeo é assistido ao vivo por administradores da sua empresa e não é gravado pela plataforma.
e) Kavicki.com: acessa os dados apenas quando necessário para operar, manter e dar suporte à plataforma, em nome da empresa empregadora.

8. Compartilhamento com terceiros
Para funcionar, o SWI conta com prestadores de serviço que recebem somente os dados necessários à sua função: hospedagem e armazenamento de arquivos, onde ficam o banco de dados, as fotos e os anexos; envio de e-mail, para códigos de verificação, redefinição de senha e denúncias; mapas e cálculo de rotas, que recebem coordenadas para traçar rotas de resgate e de evacuação; previsão do tempo, que recebe a localização da obra; consulta de CEP, que recebe o CEP digitado no cadastro; e servidores de apoio à conexão da transmissão da câmera, que veem apenas o endereço de rede do aparelho, não o vídeo. As leituras do relógio passam pelo sistema do fabricante do celular e do relógio, conforme as regras dele.
Alguns desses prestadores podem processar dados fora do Brasil. Nesses casos, a transferência segue as hipóteses que a LGPD permite para transferência internacional.
Os dados também podem ser compartilhados com autoridades públicas quando houver obrigação legal ou ordem judicial.

9. Por quanto tempo os dados ficam guardados
O histórico detalhado de posições e as leituras brutas do relógio são apagados automaticamente depois de 30 dias, salvo prazo diferente definido na configuração da plataforma; depois desse prazo ficam apenas resumos diários. A última posição conhecida de cada trabalhador é mantida para a operação do mapa.
Os demais dados (cadastro, exames, mensagens, relatórios, alertas e notificações) ficam guardados enquanto a sua conta existir e pelo prazo que a empresa empregadora precisar para cumprir obrigações legais, como a guarda de registros de saúde e segurança do trabalho. A exclusão ou desativação da conta é feita pela empresa empregadora. Ao excluir um relatório, as fotos anexadas a ele também são apagadas.

10. Seus direitos
Como titular, você pode pedir, a qualquer momento (art. 18 da LGPD): confirmação de que seus dados são tratados; acesso aos dados; correção de dados incompletos, inexatos ou desatualizados; anonimização, bloqueio ou eliminação de dados desnecessários, excessivos ou tratados em desconformidade com a lei; portabilidade; eliminação dos dados tratados com base no consentimento; informação sobre com quem os dados foram compartilhados; informação sobre a possibilidade de não consentir e suas consequências; e revogação do consentimento.
Os pedidos devem ser feitos à empresa empregadora, pelo canal de atendimento de privacidade que ela indicar ou, na falta dele, pelo setor responsável por pessoal ou por segurança do trabalho. A Kavicki.com apoia a empresa empregadora no atendimento. Você também pode apresentar reclamação à Autoridade Nacional de Proteção de Dados (ANPD).

11. Segurança
A comunicação entre o aplicativo, o painel e os servidores é feita por conexão cifrada (HTTPS). Senhas e códigos de verificação são guardados apenas em forma cifrada, e a senha exige no mínimo 8 caracteres, com número, letra maiúscula e símbolo. As sessões expiram, as tentativas de acesso são limitadas, cada empresa acessa apenas os próprios dados e os arquivos são abertos por links temporários. No celular, a sessão fica guardada na área protegida do aparelho.
Nenhum sistema é totalmente imune a falhas. Em caso de incidente de segurança que possa trazer risco ou dano relevante, a empresa empregadora, com o apoio da Kavicki.com, comunicará a ANPD e as pessoas afetadas, conforme o art. 48 da LGPD.

12. Termos de uso
a) A sua conta é pessoal e intransferível. Guarde a senha e avise a empresa empregadora se suspeitar de uso indevido.
b) O SWI deve ser usado somente para fins de trabalho. É proibido usar o chat ou os anexos para conteúdo ofensivo, discriminatório, ilegal ou alheio ao trabalho.
c) O SWI complementa, mas não substitui, os procedimentos de emergência, os equipamentos de proteção e as orientações de segurança da empresa empregadora, nem o atendimento médico.
d) O funcionamento depende de bateria, de sinal de internet e de GPS e do relógio pareado. Leituras podem atrasar ou falhar; em caso de dúvida, siga os procedimentos de segurança da sua empresa.
e) A empresa empregadora pode suspender ou desativar contas conforme as regras internas dela.

13. Alterações
Este documento pode ser atualizado para acompanhar mudanças na plataforma ou na lei. Cada nova versão traz número e data no topo e fica disponível no aplicativo e no painel.

14. Legislação aplicável
Este documento é regido pelas leis brasileiras, em especial pela LGPD.`

// Privacy policy modal. Title in primary green + close X,
// long scrollable body text, footer title "Acordo de termos de uso e
// privacidade". Trigger: "Política de privacidade e termos de uso" link.
export function PrivacyPolicyModal({ onClose }: { onClose: () => void }) {
  const theme = useTheme()
  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.6)',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 100,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Fechar modal"
        onPress={onClose}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      <View
        style={{
          width: 596,
          maxHeight: 600,
          backgroundColor: theme.background,
          borderRadius: theme.border.radius.l,
          padding: theme.padding.m,
          gap: theme.gap.m,
          overflow: 'hidden',
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.m }}>
          <View style={{ flex: 1 }}>
            <Title variant="title.xs" color={theme.content.primary}>
              Política de privacidade
            </Title>
          </View>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Fechar"
            onPress={onClose}
            style={{ padding: 4 }}
          >
            <Icon name="close" size={20} color={theme.content.dark} />
          </Pressable>
        </View>
        <div
          className="no-scrollbar"
          style={{
            flex: 1,
            overflowY: 'auto',
            overflowX: 'hidden',
            minHeight: 0,
          }}
        >
          <Text variant="body.m" color={theme.content.dark}>
            {PRIVACY_POLICY_TEXT}
          </Text>
        </div>
        <Title variant="title.xs" color={theme.content.dark}>
          Acordo de termos de uso e privacidade
        </Title>
      </View>
    </View>
  )
}
