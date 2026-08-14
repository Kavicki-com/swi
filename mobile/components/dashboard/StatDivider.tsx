import { memo } from 'react';
import Svg, { Defs, LinearGradient, Path, Stop } from 'react-native-svg';
import { DIVIDER_GRAD_END, DIVIDER_GRAD_MID } from '../../lib/dashboardDecor';
import { useUniqueId } from '../../lib/uniqueSvg';

// 1px de largura por 106 de altura, com gradiente que vai do escuro nas pontas
// ao verde de marca no meio.
//
// O `theme` que o dashboard passava nunca foi usado: as cores vêm das paradas
export const StatDivider = memo(function StatDivider() {
  const gradId = useUniqueId('divider-grad');
  return (
    <Svg width={2} height={106} viewBox="0 0 2 106">
      <Defs>
        <LinearGradient
          id={gradId}
          x1="0.5"
          y1="0"
          x2="0.5"
          y2="106"
          gradientUnits="userSpaceOnUse"
        >
          <Stop offset="0" stopColor={DIVIDER_GRAD_END} />
          <Stop offset="0.2" stopColor={DIVIDER_GRAD_MID} />
          <Stop offset="0.8" stopColor={DIVIDER_GRAD_MID} />
          <Stop offset="1" stopColor={DIVIDER_GRAD_END} />
        </LinearGradient>
      </Defs>
      <Path d="M2 106H0V0H2V106Z" fill={`url(#${gradId})`} />
    </Svg>
  );
});
