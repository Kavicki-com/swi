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
import { ActivityIndicator, PanResponder, Platform, View } from 'react-native';
import { Canvas, useFrame } from '@react-three/fiber/native';
import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';
import { GLTFLoader } from 'three-stdlib';
import type { Group } from 'three';
import type { Smartwatch3DProps } from './Smartwatch3D.types';

const SW3D_DEBUG = false;
const sw3dLog = (...args: unknown[]) => {
  if (SW3D_DEBUG) {
    // eslint-disable-next-line no-console
    console.log('[SW3D]', `(${Platform.OS})`, ...args);
  }
};

// Module-level cache: a scene parseada é estática (não muda entre instâncias).
// Primeiro mount paga download + parse (~3-5s); mounts subsequentes pegam
// da cache instantaneamente. inFlightPromise dedupe chamadas concorrentes
// (ex: usuário navega rápido entre connection-start e complete).
let cachedScene: Group | null = null;
let inFlightPromise: Promise<Group> | null = null;

type PhaseCallback = (phase: string) => void;

async function loadSmartwatchScene(onPhase?: PhaseCallback): Promise<Group> {
  if (cachedScene) {
    sw3dLog('cache hit — returning cached scene');
    onPhase?.('scene-ready');
    return cachedScene;
  }
  if (inFlightPromise) {
    sw3dLog('inflight hit — joining existing load promise');
    onPhase?.('joining-inflight');
    return inFlightPromise;
  }

  inFlightPromise = (async () => {
    try {
      onPhase?.('requiring-module');
      sw3dLog('phase: require(.../smartwatch.glb)');
      const assetModule = require('../assets/smartwatch.glb');

      onPhase?.('asset-from-module');
      const asset = Asset.fromModule(assetModule);
      sw3dLog('asset before download:', { uri: asset.uri, localUri: asset.localUri, downloaded: asset.downloaded });

      onPhase?.('download-async');
      const t0 = Date.now();
      await asset.downloadAsync();
      sw3dLog('downloadAsync done in', Date.now() - t0, 'ms');

      const localUri = asset.localUri ?? asset.uri;
      if (!localUri) throw new Error('no localUri after downloadAsync');

      onPhase?.('reading-bytes');
      const file = new File(localUri);
      const t1 = Date.now();
      const buffer = await file.arrayBuffer();
      sw3dLog('arrayBuffer in', Date.now() - t1, 'ms, byteLength=', buffer.byteLength);
      if (buffer.byteLength === 0) throw new Error('empty buffer (0 bytes)');

      onPhase?.('parsing-gltf');
      const loader = new GLTFLoader();
      // Quantize-compressed GLB — GLTFLoader stock lê nativamente.
      const t2 = Date.now();
      const scene = await new Promise<Group>((resolve, reject) => {
        loader.parse(
          buffer,
          '',
          (gltf) => {
            sw3dLog('GLTF parse OK in', Date.now() - t2, 'ms, scene children=', gltf.scene.children.length);
            resolve(gltf.scene as unknown as Group);
          },
          (err) => reject(err instanceof Error ? err : new Error(String(err))),
        );
      });

      cachedScene = scene;
      onPhase?.('scene-ready');
      return scene;
    } finally {
      // Limpa flag inflight — se houve erro, próxima tentativa refaz a pipeline
      // do zero (não cacheia erros).
      inFlightPromise = null;
    }
  })();

  return inFlightPromise;
}

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
    // Gate: pular o ciclo inteiro quando não há motivo pra escrever. Antes,
    // o callback escrevia rotation 60fps mesmo parado → JS thread queimando
    // sem mudança visual. Agora só roda se está auto-rotacionando OU
    // arrastando OU ainda há ângulo pendente vs último frame.
    if (!autoRotate && !isDraggingRef.current) return;
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
    loadSmartwatchScene()
      .then((s) => {
        if (!cancelled) setScene(s);
      })
      .catch((err: unknown) => {
        sw3dLog('loadSmartwatchScene failed:', err);
      });
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

  sw3dLog('rendering Canvas with scene');
  return (
    <View style={{ width, height }} testID={testID} {...panResponder.panHandlers}>
      <Canvas
        camera={{ position: [0, 0, 4], fov: 45 }}
        gl={{ antialias: true }}
        onCreated={(state) => {
          sw3dLog('Canvas onCreated — GL context established', {
            gl: !!state.gl,
            scene: !!state.scene,
            camera: !!state.camera,
          });
        }}
      >
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
