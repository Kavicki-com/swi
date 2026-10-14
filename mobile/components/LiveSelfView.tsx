// Self-view da câmera na web: não há câmera (liveMedia é null fora de
// Android/iOS), então não há o que mostrar. O Metro escolhe
// LiveSelfView.native.tsx para os apps e este arquivo para a web.
export function LiveSelfView(): null {
  return null;
}
