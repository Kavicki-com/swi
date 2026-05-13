// Interactive 3D smartwatch viewer. Loads the .glb asset provided by the
// designer (apple_watch_ultra_2.glb), renders it in a react-three-fiber
// Canvas, and lets the user rotate via drag (OrbitControls).
//
// Stack:
//   - three: core 3D math + GLTFLoader
//   - @react-three/fiber: React renderer for three.js scenes
//   - @react-three/drei: helpers (OrbitControls)
//   - expo-asset: resolves require()'d binary assets to URIs Metro can serve
//
// Notes:
//   - .glb is bundled via metro.config.js (assetExts includes 'glb').
//   - Asset resolves async on first mount (~15MB), so we show a spinner
//     placeholder while loading.
//   - Auto-rotates slowly when not dragged, giving the "floating" feel from
//     the Figma reference without sacrificing interactivity.
import { Suspense, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { Asset } from 'expo-asset';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Group } from 'three';

export interface Smartwatch3DProps {
  /** Pixel width of the viewport. Defaults to 320 (Figma). */
  width?: number;
  /** Pixel height of the viewport. Defaults to 347 (Figma). */
  height?: number;
  /** Enable user drag-to-rotate. Defaults to true. */
  interactive?: boolean;
  /** Slow idle rotation when not being dragged. Defaults to true. */
  autoRotate?: boolean;
}

function Model({ uri }: { uri: string }) {
  const gltf = useLoader(GLTFLoader, uri);
  const ref = useRef<Group>(null);

  // Subtle idle rotation so the watch feels "alive" between user gestures.
  useFrame((_, delta) => {
    if (ref.current) {
      ref.current.rotation.y += delta * 0.4;
    }
  });

  return <primitive ref={ref} object={gltf.scene} scale={1.5} />;
}

export function Smartwatch3D({
  width = 320,
  height = 347,
  interactive = true,
  autoRotate = true,
}: Smartwatch3DProps) {
  const [uri, setUri] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const assetModule = require('../assets/smartwatch.glb');
        const asset = Asset.fromModule(assetModule);
        await asset.downloadAsync();
        if (!cancelled) {
          setUri(asset.localUri ?? asset.uri ?? null);
        }
      } catch {
        // swallow — placeholder remains visible
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!uri) {
    return (
      <View style={{ width, height, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={{ width, height }}>
      <Canvas
        camera={{ position: [0, 0, 4], fov: 45 }}
        gl={{ antialias: true, alpha: true }}
      >
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 5, 5]} intensity={1.2} />
        <directionalLight position={[-5, -3, -5]} intensity={0.4} />
        <Suspense fallback={null}>
          <Model uri={uri} />
        </Suspense>
        {interactive ? (
          <OrbitControls
            enableZoom={false}
            enablePan={false}
            autoRotate={autoRotate}
            autoRotateSpeed={1.5}
          />
        ) : null}
      </Canvas>
    </View>
  );
}
