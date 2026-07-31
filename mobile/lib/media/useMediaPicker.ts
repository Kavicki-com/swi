// Single source of truth for image picking + photo capture across the app.
// Wraps expo-image-picker with:
//   - new `mediaTypes: ['images']` API (replaces deprecated MediaTypeOptions.Images)
//   - permission UX that points the user to system settings when denied
//   - sensible defaults (quality 0.8, allowsEditing true)
//
// All entry points resolve to either the picked image URI or `null` (canceled
// / permission denied) — never throw, so callers can write
//   const uri = await pickFromGallery();
//   if (!uri) return;

import { useCallback, useMemo } from 'react';
import { Alert, Linking } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

export interface UseMediaPickerOptions {
  quality?: number;
  allowsEditing?: boolean;
}

export interface ShowPickerOptions {
  /**
   * Quando passado, o menu ganha "Remover foto" (destrutiva). Só faz sentido
   * para quem JÁ tem imagem, e quem chama é que sabe disso: a opção é opt-in e
   * slot vazio segue com o menu de três botões.
   */
  onRemove?: () => void;
}

export interface UseMediaPickerReturn {
  pickFromGallery: () => Promise<string | null>;
  takePhoto: () => Promise<string | null>;
  showPicker: (opts?: ShowPickerOptions) => Promise<string | null>;
}

function alertPermissionDenied(kind: 'galeria' | 'câmera') {
  Alert.alert(
    'Permissão necessária',
    `Precisamos de acesso à ${kind} para continuar.`,
    [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Abrir configurações', onPress: () => Linking.openSettings() },
    ],
  );
}

export function useMediaPicker(opts: UseMediaPickerOptions = {}): UseMediaPickerReturn {
  const quality = opts.quality ?? 0.8;
  const allowsEditing = opts.allowsEditing ?? true;

  const pickFromGallery = useCallback(async (): Promise<string | null> => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      alertPermissionDenied('galeria');
      return null;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing,
      quality,
    });
    if (result.canceled || !result.assets[0]) return null;
    return result.assets[0].uri;
  }, [allowsEditing, quality]);

  const takePhoto = useCallback(async (): Promise<string | null> => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (perm.status !== 'granted') {
      alertPermissionDenied('câmera');
      return null;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      allowsEditing,
      quality,
    });
    if (result.canceled || !result.assets[0]) return null;
    return result.assets[0].uri;
  }, [allowsEditing, quality]);

  // QA Mobile #4: tocar numa miniatura JÁ preenchida abria este mesmo menu, sem
  // nenhuma forma de tirar a foto. Quem tem o que remover passa `onRemove`, e
  // aí entra a quarta opção, antes do Cancelar (posição de fim de lista, como
  // manda o padrão de action sheet). Remover resolve `null`, igual a cancelar:
  // a remoção já aconteceu no callback, e quem chama continua escrevendo
  // `if (uri) ...` sem mudar nada.
  const showPicker = useCallback(
    (opts: ShowPickerOptions = {}): Promise<string | null> =>
      new Promise((resolve) => {
        const onRemove = opts.onRemove;
        Alert.alert('Adicionar imagem', undefined, [
          {
            text: 'Tirar foto',
            onPress: async () => resolve(await takePhoto()),
          },
          {
            text: 'Escolher da galeria',
            onPress: async () => resolve(await pickFromGallery()),
          },
          ...(onRemove
            ? [
                {
                  text: 'Remover foto',
                  style: 'destructive' as const,
                  onPress: () => {
                    onRemove();
                    resolve(null);
                  },
                },
              ]
            : []),
          { text: 'Cancelar', style: 'cancel' as const, onPress: () => resolve(null) },
        ]);
      }),
    [pickFromGallery, takePhoto],
  );

  return useMemo(
    () => ({ pickFromGallery, takePhoto, showPicker }),
    [pickFromGallery, takePhoto, showPicker],
  );
}
