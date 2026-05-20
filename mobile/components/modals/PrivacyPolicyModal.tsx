import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon, Text, Title, useTheme } from '@kavicki/swi-design-system';

// Figma 348:10434 — bottom-sheet "Política de privacidade".
// Body compartilhado entre `(app)/settings/privacy.tsx` (authenticated)
// e `modals/privacy-policy.tsx` (acessível da tela de sign-up).
// Wrappers de rota cuidam do backdrop transparent + Stack.Screen.

const POLICY = `Este contrato detalha os termos e condições que regem o uso do software de gestão de recursos humanos para o setor de mineração, integrando funcionalidades de smartband, desenvolvido pela renomada Mineração Excelsior. Ao acessar e utilizar este software, o usuário manifesta sua concordância integral e irrestrita com todos os termos e condições estipulados neste documento. Este acordo estabelece as bases para a utilização do software, delineando os direitos e responsabilidades tanto do usuário quanto da Mineração Excelsior. É imprescindível que o usuário leia atentamente e compreenda integralmente cada cláusula antes de prosseguir com a utilização do software. A Mineração Excelsior reserva-se o direito de modificar, complementar ou atualizar estes termos a qualquer momento, mediante notificação prévia aos usuários. O uso contínuo do software após a publicação de quaisquer alterações constituirá aceitação tácita das mesmas. O software de gestão de recursos humanos da Mineração Excelsior, em conjunto com a tecnologia smartband, oferece uma solução abrangente para o monitoramento e gestão eficiente dos funcionários no ambiente de mineração. As funcionalidades incluem, mas não se limitam a, rastreamento em tempo real da localização dos funcionários, monitoramento de sinais vitais, comunicação bidirecional, alertas de segurança e gestão de jornadas de trabalho. A Mineração Excelsior emprega medidas de segurança rigorosas para proteger os dados dos usuários e garantir a confidencialidade das informações. No entanto, o usuário reconhece que nenhum sistema de segurança é infalível e que a Mineração Excelsior não pode garantir a segurança absoluta dos dados. O usuário é responsável por manter a confidencialidade de suas credenciais de acesso e por notificar imediatamente a Mineração Excelsior em caso de qualquer uso não autorizado de sua conta. O software é fornecido 'no estado em que se encontra' e a Mineração Excelsior não oferece garantias de qualquer tipo, expressas ou implícitas, incluindo, mas não se limitando a, garantias de comercialização, adequação a um propósito específico e não violação. Em nenhuma circunstância a Mineração Excelsior será responsável por quaisquer danos diretos, indiretos, incidentais, especiais ou consequenciais decorrentes do uso ou da impossibilidade de uso do software, mesmo que tenha sido avisada da possibilidade de tais danos. Este contrato será regido e interpretado de acordo com as leis do Brasil, e qualquer disputa decorrente deste contrato será resolvida nos tribunais competentes da cidade de Belo Horizonte, Minas Gerais. Ao utilizar o software, o usuário concorda em cumprir todas as leis e regulamentos aplicáveis, incluindo, mas não se limitando a, leis de proteção de dados e privacidade. A Mineração Excelsior reserva-se o direito de suspender ou encerrar o acesso do usuário ao software em caso de violação destes termos e condições. Este contrato constitui o acordo integral entre o usuário e a Mineração Excelsior em relação ao uso do software e substitui todos os acordos anteriores ou contemporâneos, escritos ou orais. Caso alguma disposição deste contrato seja considerada inválida ou inexequível, as demais disposições permanecerão em pleno vigor e efeito. O usuário declara ter lido, compreendido e concordado com todos os termos e condições deste contrato antes de utilizar o software da Mineração Excelsior.`;

interface PrivacyPolicyModalProps {
  onClose: () => void;
}

export function PrivacyPolicyModal({ onClose }: PrivacyPolicyModalProps) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        backgroundColor: theme.background,
        paddingTop: theme.padding.m,
        paddingHorizontal: theme.padding.m,
        paddingBottom: insets.bottom + theme.padding.m,
        borderTopLeftRadius: theme.border.radius.l,
        borderTopRightRadius: theme.border.radius.l,
        gap: theme.gap.m,
        maxHeight: '90%',
      }}
    >
      {/* Header: title + close icon */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.m }}>
        <View style={{ flex: 1 }}>
          <Title variant="title.xs" color={theme.content.primary}>
            Política de privacidade
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

      <ScrollView showsVerticalScrollIndicator={false}>
        <Text
          variant="body.m"
          color={theme.content.dark}
          style={{ lineHeight: theme.fontSize.m * 1.4 }}
        >
          {POLICY}
        </Text>
      </ScrollView>
    </View>
  );
}
