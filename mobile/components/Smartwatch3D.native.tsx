// Interactive 3D smartwatch viewer (native).
//
// Why this is hand-rolled instead of `useGLTF` from drei:
// drei's `useGLTF` → `useLoader(GLTFLoader)` → `GLTFLoader.load(uri)` which
// internally `fetch(file://...)` on RN. On iOS + Hermes that round-trip
// returns a body the GLTFLoader can't parse and you get a useless
// "Cannot read property 'type' of undefined" error inside R3F's onError.
// Loading the binary ourselves via expo-file-system's File.arrayBuffer()
// and calling `GLTFLoader.parse(buffer)` directly bypasses the broken
// fetch path entirely.
//
// Stack:
//   - @react-three/fiber/native — Expo-GL backed renderer.
//   - expo-asset — resolves require('.../smartwatch.glb') to a localUri.
//   - expo-file-system v19 File API — reads the .glb as ArrayBuffer.
//   - three-stdlib's GLTFLoader — same instance drei uses, so the
//     resulting scene is recognized by R3F's reconciler (avoids the
//     "Multiple instances of Three.js" class-identity trap).
//   - PanResponder — drag-to-rotate around Y. Lighter than OrbitControls
//     and doesn't depend on gesture-handler wiring inside the GL canvas.
import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, PanResponder, View } from 'react-native';
import { Canvas, useFrame } from '@react-three/fiber/native';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { GLTFLoader } from 'three-stdlib';
import type { Group } from 'three';
import type { Smartwatch3DProps } from './Smartwatch3D.types';

interface ModelProps {
  scene: Group;
  scale: number;
  autoRotate: boolean;
  rotationXRef: React.MutableRefObject<number>;
  rotationYRef: React.MutableRefObject<number>;
  isDraggingRef: React.MutableRefObject<boolean>;
}

function Model({
  scene,
  scale,
  autoRotate,
  rotationXRef,
  rotationYRef,
  isDraggingRef,
}: ModelProps) {
  const ref = useRef<Group>(null);

  useFrame((_, delta) => {
    if (!ref.current) return;
    // Auto-rotation only on Y (the "up" axis) — spinning on X looks like a
    // glitch. User drag controls both axes; while dragging, autoRotate
    // pauses so the user's frame of reference doesn't drift.
    if (autoRotate && !isDraggingRef.current) {
      rotationYRef.current += delta * 0.4;
    }
    ref.current.rotation.x = rotationXRef.current;
    ref.current.rotation.y = rotationYRef.current;
  });

  return <primitive ref={ref} object={scene} scale={scale} />;
}

export function Smartwatch3D({
  width,
  height,
  autoRotate = true,
  interactive = true,
  scale = 1,
  testID,
}: Smartwatch3DProps) {
  const [scene, setScene] = useState<Group | null>(null);
  const rotationXRef = useRef(0);
  const rotationYRef = useRef(0);
  const isDraggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartYRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const assetModule = require('../assets/smartwatch.glb');
        const asset = Asset.fromModule(assetModule);
        await asset.downloadAsync();
        const localUri = asset.localUri ?? asset.uri;
        if (!localUri) {
          console.warn('[Smartwatch3D] no localUri after downloadAsync');
          return;
        }

        const file = new File(localUri);
        const buffer = await file.arrayBuffer();

        const loader = new GLTFLoader();
        loader.parse(
          buffer,
          '',
          (gltf) => {
            if (!cancelled) {
              setScene(gltf.scene as unknown as Group);
            }
          },
          (err) => {
            console.warn('[Smartwatch3D] GLTF parse error:', err);
          },
        );
      } catch (err) {
        console.warn('[Smartwatch3D] load pipeline threw:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => interactive,
        onMoveShouldSetPanResponder: () => interactive,
        onPanResponderGrant: () => {
          isDraggingRef.current = true;
          dragStartXRef.current = rotationXRef.current;
          dragStartYRef.current = rotationYRef.current;
        },
        onPanResponderMove: (_, gesture) => {
          // Convert drag deltas (px) into radians. ~200px per full turn feels
          // natural for a 320-wide viewport (one swipe ≈ one rotation).
          // dx → Y rotation (horizontal spin), dy → X rotation (tilt up/down).
          rotationYRef.current = dragStartYRef.current + (gesture.dx / 200) * Math.PI;
          rotationXRef.current = dragStartXRef.current + (gesture.dy / 200) * Math.PI;
        },
        onPanResponderRelease: () => {
          isDraggingRef.current = false;
        },
        onPanResponderTerminate: () => {
          isDraggingRef.current = false;
        },
      }),
    [interactive],
  );

  if (!scene) {
    return (
      <View
        style={{ width, height, alignItems: 'center', justifyContent: 'center' }}
        testID={testID}
      >
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <View style={{ width, height }} testID={testID} {...panResponder.panHandlers}>
      <Canvas camera={{ position: [0, 0, 4], fov: 45 }} gl={{ antialias: true }}>
        <ambientLight intensity={0.6} />
        <directionalLight position={[5, 5, 5]} intensity={1.2} />
        <directionalLight position={[-5, -3, -5]} intensity={0.4} />
        <Model
          scene={scene}
          scale={scale}
          autoRotate={autoRotate}
          rotationXRef={rotationXRef}
          rotationYRef={rotationYRef}
          isDraggingRef={isDraggingRef}
        />
      </Canvas>
    </View>
  );
}
