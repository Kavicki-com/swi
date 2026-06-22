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

export interface UseMediaPickerReturn {
  pickFromGallery: () => Promise<string | null>;
  takePhoto: () => Promise<string | null>;
  showPicker: () => Promise<string | null>;
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

  const showPicker = useCallback(
    (): Promise<string | null> =>
      new Promise((resolve) => {
        Alert.alert('Adicionar imagem', undefined, [
          {
            text: 'Tirar foto',
            onPress: async () => resolve(await takePhoto()),
          },
          {
            text: 'Escolher da galeria',
            onPress: async () => resolve(await pickFromGallery()),
          },
          { text: 'Cancelar', style: 'cancel', onPress: () => resolve(null) },
        ]);
      }),
    [pickFromGallery, takePhoto],
  );

  return useMemo(
    () => ({ pickFromGallery, takePhoto, showPicker }),
    [pickFromGallery, takePhoto, showPicker],
  );
}
