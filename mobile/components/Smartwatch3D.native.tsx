import { Suspense, useRef, useState } from 'react';
import { Image, View } from 'react-native';
import { Canvas, useFrame } from '@react-three/fiber/native';
import { useGLTF } from '@react-three/drei/native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import type { Group } from 'three';
import type { Smartwatch3DProps } from './Smartwatch3D.types';
import { isFeatureEnabled } from '../lib/featureFlags';

// drei's useGLTF accepts a Metro require() handle (resolved by the
// asset extension registered in metro.config.js -> glb).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const SMARTWATCH_MODEL = require('../assets/smartwatch.glb');

interface ModelProps {
  scale: number;
  autoRotate: boolean;
  dragYRef: React.MutableRefObject<number>;
}

function Model({ scale, autoRotate, dragYRef }: ModelProps) {
  const ref = useRef<Group>(null);
  const { scene } = useGLTF(SMARTWATCH_MODEL) as unknown as { scene: Group };

  useFrame((_, dt) => {
    if (!ref.current) return;
    // Auto-rotate accumulates into the same ref so it survives drag handoff.
    if (autoRotate) {
      dragYRef.current += dt * 0.4; // ~23deg/sec
    }
    // User drag is authoritative for absolute Y rotation each frame.
    ref.current.rotation.y = dragYRef.current;
  });

  return <primitive ref={ref} object={scene} scale={scale} />;
}

const IDLE_RESUME_MS = 2000;

// Wrapper that decides which variant to render. Keeps the gate check
// outside the canvas component so its hooks are unconditional. Before
// R-2 (2026-05-17), the gate was inside the canvas component and called
// `return` before the hooks below, violating Rules of Hooks.
export function Smartwatch3D(props: Smartwatch3DProps) {
  if (!isFeatureEnabled('smartwatch3d')) {
    return <Smartwatch3DFallback {...props} />;
  }
  return <Smartwatch3DCanvas {...props} />;
}

function Smartwatch3DFallback({ width, height, testID }: Smartwatch3DProps) {
  return (
    <Image
      source={require('../assets/smartwatch.png')}
      resizeMode="contain"
      style={{ width, height }}
      testID={testID}
    />
  );
}

function Smartwatch3DCanvas({
  width,
  height,
  autoRotate = true,
  interactive = true,
  scale = 1,
  testID,
}: Smartwatch3DProps) {
  const dragYRef = useRef(0);
  const [userInteracting, setUserInteracting] = useState(false);
  const idleResumeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const beginInteraction = () => {
    if (idleResumeTimer.current) {
      clearTimeout(idleResumeTimer.current);
      idleResumeTimer.current = null;
    }
    setUserInteracting(true);
  };

  const scheduleResume = () => {
    if (idleResumeTimer.current) clearTimeout(idleResumeTimer.current);
    idleResumeTimer.current = setTimeout(() => {
      setUserInteracting(false);
      idleResumeTimer.current = null;
    }, IDLE_RESUME_MS);
  };

  const pan = Gesture.Pan()
    .enabled(interactive)
    .onBegin(() => {
      'worklet';
      runOnJS(beginInteraction)();
    })
    .onChange((e) => {
      'worklet';
      // changeX is the per-event horizontal delta (points). Sensitivity is
      // tuned so a full-screen swipe spans roughly half a turn.
      dragYRef.current += e.changeX * 0.01;
    })
    .onEnd(() => {
      'worklet';
      runOnJS(scheduleResume)();
    });

  const shouldAutoRotate = autoRotate && !userInteracting;

  return (
    <GestureDetector gesture={pan}>
      <View style={{ width, height }} testID={testID}>
        <Canvas camera={{ position: [0, 0, 5], fov: 45 }} gl={{ antialias: true }}>
          <ambientLight intensity={0.6} />
          <directionalLight position={[5, 5, 5]} intensity={1.2} />
          <Suspense fallback={null}>
            <Model scale={scale} autoRotate={shouldAutoRotate} dragYRef={dragYRef} />
          </Suspense>
        </Canvas>
      </View>
    </GestureDetector>
  );
}

// Preload the GLB so the first mount doesn't show a blank canvas while
// Metro decodes the binary buffer. Gated to prod builds — Expo Go iOS
// crashes when expo-gl tries to decode this asset at startup.
if (isFeatureEnabled('smartwatch3d')) {
  useGLTF.preload(SMARTWATCH_MODEL);
}
