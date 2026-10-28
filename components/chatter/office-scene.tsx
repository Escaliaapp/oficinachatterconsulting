'use client';
import { visibleSpeech } from '@/lib/chatter/dialogue';

import { Component, memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { ACESFilmicToneMapping, BufferGeometry, CanvasTexture, Color, Group, Mesh, MeshStandardMaterial, PCFShadowMap, SRGBColorSpace, Vector3 } from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { Employee, EmployeeRuntime } from '@/lib/chatter/types';
import { OFFICE_LAYOUT } from '@/lib/chatter/layout';

type Vec3 = [number, number, number];
export type CameraCommand = { type: 'zoom-in' | 'zoom-out' | 'reset' | 'rotate'; nonce: number } | null;
export interface OfficeSceneProps {
  employees: Employee[];
  agents: EmployeeRuntime[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  paused: boolean;
  speed: number;
  labels: boolean;
  cameraCommand: CameraCommand;
  onConversation?: (id: string) => void;
}

const WOOD = '#bd8d56';
const DARK = '#202c2b';
const METAL = '#34433d';

function Box({ position, size, color, rotation, emissive, opacity = 1, cast = true }: { position: Vec3; size: Vec3; color: string; rotation?: Vec3; emissive?: string; opacity?: number; cast?: boolean }) {
  return <mesh position={position} rotation={rotation} castShadow={cast} receiveShadow>
    <boxGeometry args={size} />
    <meshStandardMaterial color={color} roughness={.76} metalness={.05} emissive={emissive} emissiveIntensity={emissive ? 1.15 : 0} transparent={opacity < 1} opacity={opacity} depthWrite={opacity === 1} />
  </mesh>;
}

function Cylinder({ position, radius, height, color, topRadius, rotation }: { position: Vec3; radius: number; height: number; color: string; topRadius?: number; rotation?: Vec3 }) {
  return <mesh position={position} rotation={rotation} castShadow receiveShadow><cylinderGeometry args={[topRadius ?? radius, radius, height, 14]} /><meshStandardMaterial color={color} roughness={.75} /></mesh>;
}

function Sphere({ position, size, color, rotation }: { position: Vec3; size: Vec3; color: string; rotation?: Vec3 }) {
  return <mesh position={position} scale={size} rotation={rotation} castShadow><sphereGeometry args={[1, 12, 10]} /><meshStandardMaterial color={color} roughness={.8} /></mesh>;
}

function SurfaceLabel({ text, subtext, position, width = 3, height = .8, color = '#d6edb4', background = 'transparent', rotation = [0, 0, 0] }: { text: string; subtext?: string; position: Vec3; width?: number; height?: number; color?: string; background?: string; rotation?: Vec3 }) {
  const texture = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 1024; canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    if (background !== 'transparent') { ctx.fillStyle = background; ctx.fillRect(0, 0, 1024, 256); }
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = color;
    ctx.font = `600 ${subtext ? 76 : 80}px Arial, sans-serif`;
    ctx.fillText(text, 512, subtext ? 95 : 128, 980);
    if (subtext) { ctx.font = '400 29px Arial, sans-serif'; ctx.fillStyle = '#a2b5a8'; ctx.fillText(subtext, 512, 180, 950); }
    const result = new CanvasTexture(canvas); result.colorSpace = SRGBColorSpace; return result;
  }, [text, subtext, color, background]);
  useEffect(() => () => texture.dispose(), [texture]);
  return <mesh position={position} rotation={rotation}><planeGeometry args={[width, height]} /><meshBasicMaterial map={texture} transparent toneMapped={false} depthWrite={false} /></mesh>;
}

const Plant = memo(function Plant({ x, z, scale = 1, y = 0, variant = 0 }: { x: number; z: number; scale?: number; y?: number; variant?: number }) {
  return <group position={[x, y, z]} scale={scale}>
    <Cylinder position={[0, .29, 0]} radius={.24} topRadius={.34} height={.56} color={variant % 2 ? '#d5b38a' : '#e0dfd2'} />
    <Cylinder position={[0, .58, 0]} radius={.29} height={.025} color="#48472c" />
    <Cylinder position={[0, 1.15, 0]} radius={.035} height={1.25} color="#677346" />
    {Array.from({ length: 9 }, (_, i) => {
      const a = i * 2.4 + variant; const level = .9 + (i % 3) * .32;
      return <group key={i} position={[Math.sin(a) * .15, level, Math.cos(a) * .15]} rotation={[Math.sin(a) * .7, a, .35]}>
        <Sphere position={[0, .13, .17]} size={[.13, .38, .11]} color={['#608044', '#829751', '#3d683b'][i % 3]} rotation={[.6, 0, -.35]} />
      </group>;
    })}
  </group>;
});

function Chair({ x, z, rotation = 0, color = '#344f49' }: { x: number; z: number; rotation?: number; color?: string }) {
  return <group position={[x, 0, z]} rotation={[0, rotation, 0]}>
    <Cylinder position={[0, .29, 0]} radius={.045} height={.55} color={METAL} />
    <Box position={[0, .11, 0]} size={[.62, .045, .06]} color={METAL} />
    <Box position={[0, .11, 0]} size={[.06, .045, .62]} color={METAL} />
    <Box position={[0, .6, 0]} size={[.64, .16, .62]} color={color} />
    <Box position={[0, .99, .27]} size={[.64, .67, .12]} color={color} rotation={[-.08, 0, 0]} />
    <Box position={[-.36, .83, 0]} size={[.055, .065, .4]} color={METAL} />
    <Box position={[.36, .83, 0]} size={[.055, .065, .4]} color={METAL} />
    {[-.28, .28].flatMap((a) => [-.22, .22].map(b => <Sphere key={`${a}${b}`} position={[a, .075, b]} size={[.055, .055, .055]} color="#101a17" />))}
  </group>;
}

function Monitor({ x = 0, z = 0, y = 1.17, variant = 0, rotation = 0, width = .75 }: { x?: number; z?: number; y?: number; variant?: number; rotation?: number; width?: number }) {
  const texture = useMemo(() => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 320;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#101d27'; ctx.fillRect(0, 0, 512, 320);
    ctx.fillStyle = '#20373f'; ctx.fillRect(0, 0, 512, 32); ctx.fillRect(0, 32, 70, 288);
    ['#85baac', '#aecf85', '#e6c99a'].forEach((color, i) => { ctx.fillStyle = color; ctx.beginPath(); ctx.arc(16 + i * 15, 16, 4, 0, Math.PI * 2); ctx.fill(); });
    ctx.fillStyle = '#799588'; for (let i = 0; i < 8; i++) ctx.fillRect(12, 55 + i * 27, 39, 5);
    if (variant % 3 === 0) {
      ctx.fillStyle = '#1c3038'; ctx.fillRect(90, 52, 397, 104); ctx.fillRect(90, 176, 180, 123); ctx.fillRect(288, 176, 199, 123);
      ctx.strokeStyle = '#c3e894'; ctx.lineWidth = 5; ctx.beginPath();
      [119, 106, 123, 88, 95, 76, 84, 62, 70, 52].forEach((h, i) => { if (i === 0) ctx.moveTo(106, h + 15); else ctx.lineTo(106 + i * 40, h + 15); }); ctx.stroke();
      for (let i = 0; i < 7; i++) { ctx.fillStyle = i % 2 ? '#b6d591' : '#608e7d'; ctx.fillRect(304 + i * 24, 283 - (i * 23) % 85, 14, 17 + (i * 23) % 85); }
      ctx.strokeStyle = '#91b8a5'; ctx.lineWidth = 16; ctx.beginPath(); ctx.arc(176, 232, 36, 0, Math.PI * 1.6); ctx.stroke();
    } else if (variant % 3 === 1) {
      for (let i = 0; i < 12; i++) { ctx.fillStyle = ['#9fbe80', '#7daebc', '#b89db1'][i % 3]; ctx.fillRect(90 + (i % 3) * 14, 55 + i * 20, 100 + (i * 73) % 260, 6); }
    } else {
      ctx.fillStyle = '#ddc3a1'; ctx.fillRect(104, 55, 170, 229); ctx.fillStyle = '#8b9f79'; ctx.beginPath(); ctx.arc(190, 125, 54, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#b3866a'; ctx.fillRect(125, 172, 127, 83); ctx.fillStyle = '#789081'; ctx.fillRect(300, 55, 170, 80);
      for (let i = 0; i < 6; i++) { ctx.fillStyle = '#8da89c'; ctx.fillRect(300, 160 + i * 22, 140 - i * 10, 6); }
    }
    const t = new CanvasTexture(c); t.colorSpace = SRGBColorSpace; return t;
  }, [variant]);
  useEffect(() => () => texture.dispose(), [texture]);
  return <group position={[x, y, z]} rotation={[0, rotation, 0]}>
    <Box position={[0, .12, 0]} size={[.045, .25, .045]} color={METAL} />
    <Box position={[0, 0, .03]} size={[.29, .025, .18]} color={METAL} />
    <Box position={[0, .38, 0]} size={[width, width * .64, .045]} color="#182222" />
    <mesh position={[0, .38, .026]}><planeGeometry args={[width - .045, width * .64 - .045]} /><meshBasicMaterial map={texture} toneMapped={false} /></mesh>
  </group>;
}

function Mug({ position, color = '#ddd8c3' }: { position: Vec3; color?: string }) {
  return <group position={position}><Cylinder position={[0, .09, 0]} radius={.075} height={.17} color={color} /><Cylinder position={[0, .18, 0]} radius={.061} height={.005} color="#453120" /><mesh position={[.085, .095, 0]} rotation={[0, Math.PI / 2, 0]}><torusGeometry args={[.045, .013, 5, 10]} /><meshStandardMaterial color={color} /></mesh></group>;
}

function Desk({ x, z, variant = 0, wide = false }: { x: number; z: number; variant?: number; wide?: boolean }) {
  const width = wide ? 2.4 : 1.65;
  return <group position={[x, 0, z]}>
    <Box position={[0, 1.07, 0]} size={[width, .14, .8]} color={WOOD} />
    {[-1, 1].map(side => <group key={side}><Box position={[side * (width / 2 - .14), .52, -.28]} size={[.06, 1, .07]} color={METAL} /><Box position={[side * (width / 2 - .14), .52, .28]} size={[.06, 1, .07]} color={METAL} /><Box position={[side * (width / 2 - .14), .1, 0]} size={[.07, .07, .7]} color={METAL} /></group>)}
    <Monitor x={wide ? -.3 : -.12} z={-.18} y={1.15} variant={variant} />
    {wide && <Monitor x={.57} z={-.15} y={1.15} variant={1} rotation={-.12} width={.65} />}
    <Box position={[-.1, 1.153, .22]} size={[.48, .028, .16]} color="#d1d9ce" />
    {Array.from({ length: 6 }, (_, i) => <Box key={i} position={[-.28 + i * .065, 1.169, .22]} size={[.035, .005, .105]} color="#8a9c92" cast={false} />)}
    <Sphere position={[.27, 1.17, .23]} size={[.055, .025, .08]} color="#e3e5d7" />
    <Mug position={[width / 2 - .15, 1.15, .19]} color={variant % 2 ? '#b2bd90' : '#d5b493'} />
    <Box position={[-width / 2 + .18, 1.15, .07]} size={[.22, .025, .3]} color={['#527a68', '#c6a477', '#8a7796'][variant % 3]} rotation={[0, .13, 0]} />
    <Box position={[width / 2 - .2, .52, -.05]} size={[.3, .8, .49]} color="#a17b53" />
    <Box position={[width / 2 - .2, .75, .201]} size={[.19, .018, .012]} color="#514734" />
    <Chair x={0} z={1} color={variant % 3 === 1 ? '#737b5d' : '#354d46'} />
  </group>;
}

function Wall({ x, z, width, height = 2.8, depth = .2, glass = false }: { x: number; z: number; width: number; height?: number; depth?: number; glass?: boolean }) {
  if (!glass) return <><Box position={[x, height / 2, z]} size={[width, height, depth]} color={DARK} /><Box position={[x, .08, z + depth / 2 + .018]} size={[width, .16, .045]} color="#556052" /><Box position={[x, height + .02, z]} size={[width + .06, .08, depth + .08]} color="#546151" /></>;
  return <group><Box position={[x, height / 2, z]} size={[width, height, depth]} color="#a9d5cf" opacity={.12} cast={false} />{[-1, 1].map(side => <Box key={side} position={[x + side * width / 2, height / 2, z]} size={[.055, height, .06]} color={METAL} />)}<Box position={[x, height, z]} size={[width, .055, .06]} color={METAL} /><Box position={[x, .08, z]} size={[width, .055, .06]} color={METAL} /></group>;
}

function Bookcase({ x, z, width = 1.8 }: { x: number; z: number; width?: number }) {
  return <group position={[x, 0, z]}>
    <Box position={[0, 1.25, -.13]} size={[width, 2.5, .11]} color="#5b4c35" />
    {[-1, 1].map(s => <Box key={s} position={[s * (width / 2), 1.25, 0]} size={[.07, 2.5, .5]} color={WOOD} />)}
    {[.13, .85, 1.6, 2.4].map((h, index) => <group key={h}><Box position={[0, h, 0]} size={[width, .07, .5]} color={WOOD} />{index < 3 && Array.from({ length: 4 }, (_, b) => <Box key={b} position={[-width / 2 + .18 + b * .15, h + .2 + (b % 2) * .04, 0]} size={[.11, .32 + (b % 2) * .08, .25]} color={['#9a7057', '#c0c69d', '#516e65', '#d4bea2'][(b + index) % 4]} rotation={[0, 0, b === 3 ? -.15 : 0]} />)}{index < 3 && <Cylinder position={[width / 2 - .3, h + .14, .03]} radius={.12} height={.22} color="#b8b29a" />}</group>)}
    <Plant x={.36} z={0} y={1.64} scale={.3} />
  </group>;
}

function Pendant({ x, z, y = 3.25 }: { x: number; z: number; y?: number }) {
  return <group position={[x, y, z]}><Cylinder position={[0, .45, 0]} radius={.018} height={.9} color="#222e29" /><mesh castShadow><coneGeometry args={[.32, .3, 16, 1, true]} /><meshStandardMaterial color="#b69c68" side={2} /></mesh><Cylinder position={[0, -.1, 0]} radius={.28} height={.02} color="#efd59c" /><pointLight color="#ffd6a0" intensity={3} distance={5} decay={2} /></group>;
}

const Architecture = memo(function Architecture() {
  return <group>
    {/* The complete floor is geometry; the space remains an orbitable diorama. */}
    <Box position={[0, -.37, 0]} size={[20.4, .65, 14.4]} color="#1c2927" />
    <Box position={[0, -.035, 0]} size={[20, .06, 14]} color="#a59b84" />
    <Box position={[0, -.16, 7.21]} size={[20.1, .035, .025]} color="#8baf69" emissive="#6a9255" cast={false} />
    <Box position={[10.21, -.16, 0]} size={[.025, .035, 14.1]} color="#8baf69" emissive="#6a9255" cast={false} />
    {Array.from({ length: 20 }, (_, i) => <Box key={`tilex${i}`} position={[-9.5 + i, .004, 0]} size={[.014, .008, 14]} color="#8c8675" cast={false} />)}
    {Array.from({ length: 14 }, (_, i) => <Box key={`tilez${i}`} position={[0, .006, -6.5 + i]} size={[20, .008, .014]} color="#8c8675" cast={false} />)}
    {/* Warm oak in the private office and social spaces. */}
    {[{ x: -7.5, z: -4.5, w: 4.6, d: 4.6 }, { x: 6.3, z: -4.5, w: 7.2, d: 4.6 }, { x: -7.5, z: 4.8, w: 4.6, d: 4.1 }].map((p, n) => <group key={n}><Box position={[p.x, .015, p.z]} size={[p.w, .025, p.d]} color={n === 1 ? '#a98b62' : '#af8355'} cast={false} />{Array.from({ length: Math.floor(p.w / .26) }, (_, i) => <Box key={i} position={[p.x - p.w / 2 + i * .26, .032, p.z]} size={[.009, .006, p.d]} color="#896846" cast={false} />)}</group>)}
    <Wall x={0} z={-7} width={20.2} />
    <Wall x={-10} z={-2.6} width={.2} depth={8.8} />
    <Wall x={10} z={-4.7} width={.2} depth={4.6} />
    <Wall x={-5} z={-4.15} width={.16} depth={3.7} glass />
    <Wall x={2.5} z={-4.15} width={.12} depth={3.7} glass />
    {/* Partition posts and glass tracks. */}
    {[-5, 2.5].flatMap(x => [-6, -4.1, -2.3].map(z => <Box key={`${x}${z}`} position={[x, 1.4, z]} size={[.055, 2.8, .06]} color={METAL} />))}
    <Box position={[-5, 2.8, -4.15]} size={[.07, .07, 3.7]} color={METAL} />
    <Box position={[2.5, 2.8, -4.15]} size={[.07, .07, 3.7]} color={METAL} />
    <Wall x={-5} z={4.75} width={.14} height={1.9} depth={3.5} glass />
    <Box position={[-5, 1.94, 4.75]} size={[.08, .08, 3.5]} color={METAL} />
    {[-10, -5, 2.5, 10].map(x => <Box key={x} position={[x, 2.87, -6.94]} size={[.3, .12, .3]} color="#a4aa91" />)}
    {/* Slatted timber feature walls. */}
    {Array.from({ length: 21 }, (_, i) => <Box key={i} position={[-9.7 + i * .21, 1.4, -6.85]} size={[.09, 2.7, .09]} color={i % 3 ? '#936b44' : '#aa8353'} />)}
    <SurfaceLabel text="chatter." subtext="CONSULTING · AI AGENCY" position={[-7.5, 1.95, -6.77]} width={3.3} height={.9} color="#e2f2b8" />
    <SurfaceLabel text="SALA DE IDEAS" subtext="Grandes ideas. Mejores resultados." position={[-1.2, 2.1, -6.88]} width={3.4} height={.85} />
    <SurfaceLabel text="make it happen." position={[6.1, 2.1, -6.88]} width={4.5} height={1} color="#e4d3a9" />
    {/* Private office */}
    <Box position={[-7.2, .05, -3.9]} size={[3.5, .035, 2.7]} color="#465c4e" cast={false} />
    <Desk x={-7} z={-4.5} variant={0} wide />
    <Bookcase x={-9.2} z={-6.5} width={1.1} />
    <Plant x={-5.7} z={-6.15} scale={1.15} />
    <Plant x={-9.25} z={-2.3} scale={.95} variant={1} />
    <Pendant x={-7} z={-4.5} />
    {/* Conference room */}
    <Box position={[-1, .04, -4.5]} size={[5.1, .035, 3.8]} color="#79816d" cast={false} />
    <Box position={[-1, 1.05, -4.5]} size={[3.6, .14, 1.2]} color="#c5a779" />
    {[-2, 0].map(x => <Box key={x} position={[x, .5, -4.5]} size={[.15, 1, .8]} color={METAL} />)}
    {[-2.5, -1, .5].map((x, i) => <group key={x}><Chair x={x} z={-3.25} color="#666d51" /><Chair x={x} z={-5.75} rotation={Math.PI} color="#666d51" /><Box position={[x, 1.14, -4.25]} size={[.4, .035, .3]} color={i === 1 ? '#344f49' : '#d4cfb9'} rotation={[0, .1, 0]} /><Mug position={[x + .3, 1.13, -4.65]} /></group>)}
    <Plant x={1.75} z={-6.25} scale={.9} />
    <Pendant x={-2.1} z={-4.5} /><Pendant x={.2} z={-4.5} />
    {/* Lounge with a boucle sofa, layered rug and low table */}
    <Box position={[6.35, .06, -4.15]} size={[4.9, .04, 3.5]} color="#d1bea0" cast={false} />
    <Box position={[6.35, .085, -4.15]} size={[4.45, .015, 3.05]} color="#ad987b" cast={false} />
    <Box position={[6.65, .39, -5.25]} size={[3.8, .6, 1.05]} color="#bb9271" />
    <Box position={[6.65, .93, -5.7]} size={[3.8, 1.1, .24]} color="#c7a37d" />
    {[-1.7, 1.7].map(s => <Box key={s} position={[6.65 + s, .7, -5.23]} size={[.34, .63, 1.1]} color="#c7a37d" />)}
    {[5.5, 6.6, 7.7].map((x, i) => <group key={x}><Box position={[x, .73, -5.2]} size={[1.02, .22, .79]} color={i === 1 ? '#c8a17a' : '#d0ad86'} /><Box position={[x, 1.04, -5.53]} size={[.68, .65, .17]} color={i === 1 ? '#6b7b57' : '#d4c5a4'} rotation={[-.1, 0, i === 0 ? .15 : -.12]} /></group>)}
    <Cylinder position={[6.5, .55, -2.7]} radius={.5} height={.12} color={WOOD} /><Cylinder position={[6.5, .25, -2.7]} radius={.24} height={.5} color="#594e39" />
    <Plant x={6.5} z={-2.7} y={.62} scale={.24} /><Mug position={[6.8, .62, -2.55]} />
    <Bookcase x={9.1} z={-6.5} width={1.2} />
    <Plant x={3.3} z={-6.1} scale={1.1} /><Plant x={9.2} z={-2.6} scale={.8} variant={1} />
    <Cylinder position={[4.25, 1.3, -5.7]} radius={.025} height={2.6} color="#b5a271" /><Cylinder position={[4.25, .06, -5.7]} radius={.28} height={.09} color="#786749" />
    <mesh position={[4.25, 2.55, -5.7]}><coneGeometry args={[.45, .45, 20, 1, true]} /><meshStandardMaterial color="#dfc89a" side={2} /></mesh><pointLight position={[4.25, 2.35, -5.7]} color="#ffcb7b" intensity={4} distance={5} />
    {/* Eight dedicated specialist workstations */}
    {OFFICE_LAYOUT.desks.filter(d=>d.id!=='hermes'&&d.id!=='luna').map((desk,i)=><Desk key={desk.id} x={desk.position[0]} z={desk.position[1]} variant={i}/>)}
    <Box position={[0, 1.44, 1]} size={[8, .45, .075]} color="#80937a" />
    <Box position={[0, 1.44, 4]} size={[8, .45, .075]} color="#80937a" />
    {[-4.2, 4.25].flatMap(x => [1, 4.1].map(z => <Plant key={`${x}${z}`} x={x} z={z} scale={.8} />))}
    <Plant x={-2} z={1} y={1.67} scale={.25} /><Plant x={2} z={1} y={1.67} scale={.25} /><Plant x={0} z={4} y={1.67} scale={.25} />
    {/* Reception */}
    <Desk x={-7} z={4.2} variant={2} wide />
    <Box position={[-7, .7, 3.72]} size={[2.65, 1.4, .19]} color="#ac8758" />
    {Array.from({ length: 17 }, (_, i) => <Box key={i} position={[-8.24 + i * .15, .68, 3.61]} size={[.045, 1.2, .035]} color="#775a3c" />)}
    <SurfaceLabel text="WELCOME" position={[-7, 1, 3.6]} rotation={[0, Math.PI, 0]} width={1.75} height={.4} color="#e2e8c9" />
    <Box position={[-7.4, .05, 2.4]} size={[2.8, .025, 1]} color="#32443b" cast={false} />
    <SurfaceLabel text="chatter consulting" position={[-7.4, .07, 2.4]} rotation={[-Math.PI / 2, 0, 0]} width={2.4} height={.6} color="#b7c3a7" />
    <Plant x={-9.2} z={5.7} scale={1.1} /><Plant x={-5.7} z={3.3} scale={.65} />
    {/* Cafe with espresso machine, tile wall and cupboards */}
    <Box position={[8.8, .58, 4]} size={[.8, 1.15, 3]} color="#56705a" />
    <Box position={[8.8, 1.2, 4]} size={[.94, .1, 3.2]} color="#e1d4b8" />
    {[3.1, 4, 4.9].map(z => <group key={z}><Box position={[8.38, .6, z]} size={[.04, .93, .82]} color="#708369" /><Box position={[8.35, .88, z]} size={[.03, .04, .27]} color="#b9b399" /></group>)}
    <Box position={[8.8, 1.55, 3]} size={[.56, .61, .67]} color="#b6bdb3" />
    <Box position={[8.5, 1.54, 3]} size={[.05, .32, .52]} color="#263e37" />
    <Cylinder position={[8.48, 1.5, 2.85]} radius={.04} height={.26} color="#cad2bc" />
    <Mug position={[8.45, 1.26, 3.18]} /><Mug position={[8.75, 1.26, 3.65]} color="#a98865" />
    <Plant x={8.8} z={5.1} y={1.27} scale={.37} />
    <Box position={[9.65, 1.25, 2.85]} size={[.56, 2.5, 1]} color="#e4dfcf" />
    <Box position={[9.35, 1.26, 2.85]} size={[.03, .025, .96]} color="#8f9989" />
    <Box position={[9.32, 1.64, 3.2]} size={[.04, .38, .04]} color="#677365" />
    <Cylinder position={[6.6, .95, 4.5]} radius={.65} height={.12} color="#b99868" />
    <Cylinder position={[6.6, .46, 4.5]} radius={.07} height={.9} color={METAL} />
    <Cylinder position={[6.6, .06, 4.5]} radius={.43} height={.08} color={METAL} />
    <Mug position={[6.45, 1.02, 4.25]} /><Plant x={6.85} z={4.6} y={1.02} scale={.2} />
    <Pendant x={6.6} z={4.5} />
    <Plant x={9.15} z={6.2} scale={.9} variant={1} />
    {/* Foosball: raised rails, players and pitch markings */}
    <group position={[6.5, 0, 0]}>
      <Box position={[0, .95, 0]} size={[1.8, .3, 1]} color="#b48c54" />
      <Box position={[0, 1.11, 0]} size={[1.65, .025, .85]} color="#527d55" />
      {[-1, 1].flatMap(s => [-1, 1].map(t => <Box key={`${s}${t}`} position={[s * .68, .4, t * .32]} size={[.1, .8, .1]} color={METAL} />))}
      {[-1, 1].map(s => <Box key={s} position={[0, 1.19, s * .5]} size={[1.8, .19, .09]} color="#d4b37d" />)}
      <Box position={[0, 1.13, 0]} size={[.015, .008, .8]} color="#c6d8ad" cast={false} />
      <mesh position={[0, 1.132, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[.16, .175, 20]} /><meshBasicMaterial color="#c6d8ad" /></mesh>
      {[-.6, -.2, .2, .6].map((x, i) => <group key={x}><Cylinder position={[x, 1.3, 0]} radius={.018} height={1.45} color="#aeb6a5" rotation={[Math.PI / 2, 0, 0]} />{[-.25, .25].map(z => <Box key={z} position={[x, 1.23, z]} size={[.075, .2, .075]} color={i % 2 ? '#e1c39c' : '#406873'} />)}<Cylinder position={[x, 1.3, .74]} radius={.045} height={.17} color="#293e34" rotation={[Math.PI / 2, 0, 0]} /></group>)}
    </group>
    <Plant x={-8.7} z={.4} scale={.9} />
    {/* Small walkway lamps and department signage */}
    <SurfaceLabel text="CREATIVE STUDIO" position={[.1, .055, 6.3]} rotation={[-Math.PI / 2, 0, 0]} width={4} height={.7} color="#596b55" />
  </group>;
});

/** Combine static furniture by material so the scene does not issue thousands of draw calls. */
const BatchedArchitecture=memo(function BatchedArchitecture(){
  const source=useRef<Group>(null);
  const batches=useRef<Group>(null);
  useLayoutEffect(()=>{
    if(!source.current||!batches.current)return;
    const batchRoot=batches.current;
    const originals:Mesh[]=[];
    const groups=new Map<string,{geometries:BufferGeometry[];material:MeshStandardMaterial;cast:boolean;receive:boolean}>();
    source.current.updateWorldMatrix(true,true);
    source.current.traverse(object=>{
      if(!(object instanceof Mesh)||!(object.material instanceof MeshStandardMaterial)||object.material.map)return;
      const material=object.material;
      const key=[material.color.getHex(),material.emissive.getHex(),material.emissiveIntensity,material.roughness,material.metalness,material.opacity,material.side,material.depthWrite,object.castShadow,object.receiveShadow].join(':');
      if(!groups.has(key))groups.set(key,{geometries:[],material:material.clone(),cast:object.castShadow,receive:object.receiveShadow});
      groups.get(key)!.geometries.push(object.geometry.clone().applyMatrix4(object.matrixWorld));
      originals.push(object);object.visible=false;
    });
    const created:Mesh[]=[];
    for(const group of groups.values()){
      const geometry=mergeGeometries(group.geometries,false);
      group.geometries.forEach(g=>g.dispose());
      if(!geometry){group.material.dispose();continue;}
      const mesh=new Mesh(geometry,group.material);mesh.castShadow=group.cast;mesh.receiveShadow=group.receive;
      batchRoot.add(mesh);created.push(mesh);
    }
    return()=>{originals.forEach(mesh=>{mesh.visible=true;});created.forEach(mesh=>{batchRoot.remove(mesh);mesh.geometry.dispose();(mesh.material as MeshStandardMaterial).dispose();});};
  },[]);
  return <><group ref={source}><Architecture/></group><group ref={batches}/></>;
});

function ShadowBudget(){
  const previous=useRef(-1);
  useFrame(({gl,clock})=>{
    gl.shadowMap.autoUpdate=false;
    if(clock.elapsedTime-previous.current>.12){gl.shadowMap.needsUpdate=true;previous.current=clock.elapsedTime;}
  });
  return null;
}

function Avatar({ employee, runtime, selected, onSelect, paused, speed, labelElements }: { employee: Employee; runtime: EmployeeRuntime; selected: boolean; onSelect: OfficeSceneProps['onSelect']; paused: boolean; speed: number; labelElements:RefObject<Record<string,HTMLDivElement|null>> }) {
  const root = useRef<Group>(null);
  const body = useRef<Group>(null);
  const leftArm = useRef<Group>(null);
  const rightArm = useRef<Group>(null);
  const leftLeg = useRef<Group>(null);
  const rightLeg = useRef<Group>(null);
  const selectionRing = useRef<Mesh>(null);
  const phase = useRef(employee.name.length * .67);
  const target = useMemo(() => new Vector3(), []);
  const projected=useMemo(()=>new Vector3(),[]);
  const [initialPosition]=useState<Vec3>(()=>[runtime.position[0],0,runtime.position[1]]);
  const onSofa=runtime.state==='break'&&runtime.target==='relax'&&runtime.position[1]===-4&&runtime.position[0]>=5.5;
  const playing=runtime.state==='break'&&runtime.target==='game';
  const seated = runtime.state === 'working' || runtime.state === 'researching' || runtime.state === 'meeting'||onSofa;
  const walking = runtime.state === 'walking';
  const skin = employee.skinColor || '#c4936e';
  const hair = employee.hairColor || '#312a23';
  const shirt = employee.color || '#779881';
  const isWoman = employee.gender === 'female';
  useFrame(({camera,size}, dt) => {
    if (!root.current || !body.current) return;
    target.set(runtime.position[0], 0, onSofa?-5.05:runtime.position[1]);
    root.current.position.lerp(target, 1 - Math.exp(-dt * 14));
    const direction=onSofa?0:runtime.rotation;
    const angle = Math.atan2(Math.sin(direction - root.current.rotation.y), Math.cos(direction - root.current.rotation.y));
    root.current.rotation.y += angle * Math.min(1, dt * 9);
    if (!paused&&runtime.state!=='offline') phase.current += dt * speed;
    const t = phase.current;
    body.current.position.y = (onSofa?.05:seated ? -.12 : 0) + (walking ? Math.abs(Math.sin(t * 8)) * .045 : Math.sin(t * 2) * .012);
    if (leftLeg.current && rightLeg.current) {
      leftLeg.current.rotation.x = seated ? -Math.PI / 2 : walking ? Math.sin(t * 8) * .47 : 0;
      rightLeg.current.rotation.x = seated ? -Math.PI / 2 : walking ? -Math.sin(t * 8) * .47 : 0;
    }
    if (leftArm.current && rightArm.current) {
      leftArm.current.rotation.x = onSofa?-.2:playing?-.9+Math.sin(t*5)*.18:seated ? -.7 + Math.sin(t * 7) * .09 : walking ? -Math.sin(t * 8) * .4 : runtime.state === 'talking' ? -.4 + Math.sin(t * 3) * .2 : .08;
      rightArm.current.rotation.x = onSofa?-.2:playing?-.9+Math.cos(t*5)*.18:seated ? -.7 + Math.cos(t * 7) * .09 : walking ? Math.sin(t * 8) * .4 : runtime.state === 'break' ? -1.25 + Math.sin(t) * .1 : runtime.state === 'talking' ? -.7 + Math.cos(t * 3) * .2 : -.1;
    }
    if (selectionRing.current) selectionRing.current.rotation.z = t * .3;
    const label=labelElements?.current[employee.id];
    if(label){
      root.current.updateWorldMatrix(true,false);
      root.current.localToWorld(projected.set(0,2.13,0));projected.project(camera);
      label.style.setProperty('transform',`translate(${(projected.x*.5+.5)*size.width}px,${(-projected.y*.5+.5)*size.height}px) translate(-50%,-50%)`);
      label.style.setProperty('visibility',projected.z>1||projected.z< -1?'hidden':'visible');
    }
  });
  const click = (event: ThreeEvent<MouseEvent>) => { event.stopPropagation(); onSelect(employee.id); };
  return <group ref={root} position={initialPosition} onClick={click} onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }} onPointerOut={() => { document.body.style.cursor = ''; }}>
    <mesh position={[0, .055, 0]} rotation={[-Math.PI / 2, 0, 0]}><circleGeometry args={[.39, 24]} /><meshBasicMaterial color="#101b16" transparent opacity={.22} depthWrite={false} /></mesh>
    {selected && <mesh ref={selectionRing} position={[0, .07, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[.44, .49, 40]} /><meshBasicMaterial color="#d8f2a1" toneMapped={false} /></mesh>}
    <group ref={body}>
      <group position={[0, .78, 0]}>
        <group ref={leftLeg} position={[-.13, 0, 0]}><Cylinder position={[0, -.2, 0]} radius={.095} height={.42} color="#263c39" /><group position={[0, -.4, 0]} rotation={[seated ? Math.PI / 2 : 0, 0, 0]}><Cylinder position={[0, -.15, 0]} radius={.085} height={.33} color="#263c39" /><Box position={[0, -.32, .06]} size={[.19, .11, .31]} color="#d8dac9" /></group></group>
        <group ref={rightLeg} position={[.13, 0, 0]}><Cylinder position={[0, -.2, 0]} radius={.095} height={.42} color="#263c39" /><group position={[0, -.4, 0]} rotation={[seated ? Math.PI / 2 : 0, 0, 0]}><Cylinder position={[0, -.15, 0]} radius={.085} height={.33} color="#263c39" /><Box position={[0, -.32, .06]} size={[.19, .11, .31]} color="#d8dac9" /></group></group>
      </group>
      <Sphere position={[0, 1.04, 0]} size={[.27, .37, .17]} color={shirt} />
      <Cylinder position={[0, 1.32, 0]} radius={.095} height={.16} color={skin} />
      <group ref={leftArm} position={[-.29, 1.23, 0]} rotation={[0, 0, -.1]}><Cylinder position={[0, -.17, 0]} radius={.085} height={.35} color={shirt} /><Sphere position={[0, -.39, 0]} size={[.075, .13, .075]} color={skin} /></group>
      <group ref={rightArm} position={[.29, 1.23, 0]} rotation={[0, 0, .1]}><Cylinder position={[0, -.17, 0]} radius={.085} height={.35} color={shirt} /><Sphere position={[0, -.39, 0]} size={[.075, .13, .075]} color={skin} />{runtime.state === 'break' && runtime.target === 'coffee' && <Mug position={[0, -.48, .04]} />}</group>
      {isWoman && <Sphere position={[0, 1.48, -.11]} size={[.26, .35, .19]} color={hair} />}
      <Sphere position={[0, 1.63, 0]} size={[.235, .28, .225]} color={skin} />
      <Sphere position={[0, 1.81, -.02]} size={[.25, .15, .23]} color={hair} />
      <Sphere position={[-.19, 1.69, -.025]} size={[.07, .18, .19]} color={hair} />
      <Sphere position={[.08, 1.79, .16]} size={[.19, .09, .085]} color={hair} rotation={[0, 0, -.2]} />
      <Sphere position={[-.087, 1.65, .202]} size={[.023, .032, .018]} color="#28342c" /><Sphere position={[.087, 1.65, .202]} size={[.023, .032, .018]} color="#28342c" />
      <Sphere position={[0, 1.58, .221]} size={[.035, .038, .04]} color={skin} />
      <Box position={[0, 1.51, .204]} size={[.066, .015, .012]} color="#805747" />
      {!isWoman && (employee.id === 'hermes' || employee.id === 'diego' || employee.id === 'jorge') && <Sphere position={[0, 1.46, .073]} size={[.17, .085, .15]} color={hair} />}
      {employee.id === 'hermes' && <Box position={[0, 1.14, .16]} size={[.035, .29, .015]} color="#d1ddb4" />}
    </group>
  </group>;
}

function CameraRig({ command }: { command: CameraCommand }) {
  const controls = useRef<OrbitControlsImpl>(null);
  const get = useThree(state => state.get);
  const size = useThree(state => state.size);
  const initialZoom = useRef(30);
  useEffect(() => {
    const camera = get().camera;
    initialZoom.current = Math.min(size.width / 27, size.height / 20.5);
    camera.zoom = initialZoom.current;
    camera.updateProjectionMatrix();
  }, [size.width, size.height, get]);
  useEffect(() => {
    if (!command || !controls.current) return;
    const camera = get().camera;
    if (command.type === 'reset') {
      camera.position.set(19, 24, 25);
      camera.zoom = initialZoom.current;
      controls.current.target.set(0, .2, 0);
    } else if (command.type === 'rotate') {
      const target = controls.current.target; const delta = camera.position.clone().sub(target);
      delta.applyAxisAngle(new Vector3(0, 1, 0), Math.PI / 10); camera.position.copy(target).add(delta);
    } else {
      camera.zoom = Math.max(initialZoom.current * .65, Math.min(initialZoom.current * 2.6, camera.zoom * (command.type === 'zoom-in' ? 1.2 : 1 / 1.2)));
    }
    camera.updateProjectionMatrix(); controls.current.update();
  }, [command, get]);
  return <OrbitControls ref={controls} makeDefault target={[0, .2, 0]} enableDamping dampingFactor={.1} minPolarAngle={.45} maxPolarAngle={1.2} minAzimuthAngle={-.6} maxAzimuthAngle={1.4} minZoom={12} maxZoom={90} zoomSpeed={.7} panSpeed={.6} rotateSpeed={.5} />;
}

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <div className="scene-unavailable"><strong>La oficina 3D necesita WebGL</strong><p>Activa la aceleración gráfica del navegador. Puedes seguir consultando al equipo desde los paneles.</p></div> : this.props.children; }
}

export default function OfficeScene(props: OfficeSceneProps) {
  const labelElements=useRef<Record<string,HTMLDivElement|null>>({});
  return <div className="hq-webgl-wrap" style={{position:'absolute',inset:0}}><SceneBoundary><Canvas frameloop={props.paused?'demand':'always'} orthographic shadows={{type:PCFShadowMap}} dpr={[1, 1.25]} camera={{ position: [19, 24, 25], near: .1, far: 150, zoom: 28 }} gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }} onCreated={({ gl, scene }) => { gl.toneMapping = ACESFilmicToneMapping; gl.toneMappingExposure = 1.25; scene.background = new Color('#0c100f'); }} fallback={<div className="scene-unavailable">Activa WebGL para explorar la oficina 3D.</div>}>
    <ambientLight intensity={1.35} color="#dce6d3" />
    <hemisphereLight args={['#e4ecd7', '#4a5045', 1.8]} />
    <directionalLight position={[-7, 18, 9]} intensity={3.1} color="#ffedcf" castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-16} shadow-camera-right={16} shadow-camera-top={14} shadow-camera-bottom={-14} shadow-normalBias={.035} shadow-bias={-.0001} />
    <directionalLight position={[8, 12, -8]} intensity={1.25} color="#d3e8d8" />
    <BatchedArchitecture />
    <ShadowBudget />
    {props.agents.map(runtime => { const employee = props.employees.find(person => person.id === runtime.id); return employee ? <Avatar key={employee.id} employee={employee} runtime={runtime} selected={props.selectedId === employee.id} onSelect={props.onSelect} paused={props.paused} speed={props.speed} labelElements={labelElements} /> : null; })}
    <CameraRig command={props.cameraCommand} />
  </Canvas></SceneBoundary><div className="hq-label-layer" style={{position:'absolute',inset:0,pointerEvents:'none',zIndex:11}}>{props.employees.map(employee=>{
    const runtime=props.agents.find(a=>a.id===employee.id);const selected=props.selectedId===employee.id;
    if(!runtime)return null;
    const speech=visibleSpeech(employee,runtime,props.agents);
    if(!props.labels&&!selected&&!speech)return null;
    return <div key={employee.id} ref={element=>{labelElements.current[employee.id]=element;}} style={{position:'absolute',top:0,left:0,display:'flex',pointerEvents:'auto',visibility:'hidden'}}>
      <button className={`scene-person-label${selected?' selected':''}`} onClick={()=>props.onSelect(employee.id)} title={`${employee.name}: ${runtime.activity}`}><span style={{width:5,height:5,borderRadius:9,background:employee.color,marginRight:5}}/>{employee.name}</button>
      {speech&&<button className="scene-speech-bubble" onClick={()=>props.onConversation?.(employee.id)}><strong>{employee.name} · {runtime.state==='meeting'?'Reunión':'Trabajo en equipo'}</strong><span>{speech}</span><small>Propuesta simulada</small></button>}
    </div>;
  })}</div></div>;
}
