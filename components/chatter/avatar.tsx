'use client';

import { useId } from 'react';
import type { Employee } from '@/lib/chatter/types';

type AvatarProps = { employee: Employee; size?: number; className?: string };

/** Local, illustrated portraits. Their palette matches the procedural 3D avatars. */
export function Avatar({ employee, size = 40, className }: AvatarProps) {
  const uid = useId().replace(/:/g, '');
  const female = employee.gender === 'female';
  const beard = ['hermes', 'diego', 'jorge', 'carlos'].includes(employee.id);
  const glasses = employee.id === 'jorge';
  const bob = employee.id === 'ana';
  const curly = employee.id === 'mateo';
  const skin = employee.skinColor;
  const hair = employee.hairColor;
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" role="img" aria-label={`Retrato de ${employee.name}`} className={className} style={{ flexShrink: 0, borderRadius: '50%' }}>
      <defs>
        <clipPath id={`${uid}-clip`}><circle cx="50" cy="50" r="49" /></clipPath>
        <linearGradient id={`${uid}-bg`} x1="16" y1="0" x2="88" y2="100" gradientUnits="userSpaceOnUse"><stop stopColor={employee.color} stopOpacity=".65"/><stop offset="1" stopColor="#1d2428"/></linearGradient>
        <linearGradient id={`${uid}-skin`} x1="31" y1="35" x2="67" y2="68" gradientUnits="userSpaceOnUse"><stop stopColor={skin}/><stop offset="1" stopColor={skin}/></linearGradient>
        <linearGradient id={`${uid}-shirt`} x1="27" y1="75" x2="80" y2="105" gradientUnits="userSpaceOnUse"><stop stopColor={employee.color}/><stop offset="1" stopColor="#243136"/></linearGradient>
      </defs>
      <g clipPath={`url(#${uid}-clip)`}>
        <path fill={`url(#${uid}-bg)`} d="M0 0h100v100H0z"/>
        <circle cx="44" cy="40" r="39" fill="#fff" opacity=".035"/>
        {female && <path d={bob ? 'M27 33C25 5 72 4 75 34L80 70Q68 79 50 73Q31 79 21 68Z' : 'M27 34C23 4 73 4 76 34L82 82H19L24 54Z'} fill={hair}/>}
        <path d="M12 105L17 85Q20 77 39 72H61Q80 77 83 85L89 105Z" fill={`url(#${uid}-shirt)`}/>
        <path d="M40 61H60V76Q50 86 40 76Z" fill={skin}/>
        <path d="M40 63H60V69Q52 77 40 69Z" fill="#42291e" opacity=".18"/>
        {female ? <path d="M36 74L42 76Q50 87 59 76L64 74L60 90H40Z" fill="#131b23" opacity=".55"/> : <><path d="M35 74L43 78L50 83L41 87L31 77Z" fill="#dbe6e4" opacity=".85"/><path d="M64 74L57 78L50 83L59 87L68 77Z" fill="#dbe6e4" opacity=".7"/></>}
        <ellipse cx="31" cy="45" rx="4.5" ry="6.5" fill={skin}/><ellipse cx="69" cy="45" rx="4.5" ry="6.5" fill={skin}/>
        <path d="M31 32C32 14 69 14 69 32V49C68 63 59 70 50 70S32 63 31 49Z" fill={`url(#${uid}-skin)`}/>
        <path d="M63 29Q71 35 67 52Q65 64 53 69Q68 66 70 51V35Z" fill="#35231b" opacity=".12"/>
        {female ? <><path d="M29 40Q25 12 49 14Q76 11 72 41L65 34L63 25Q47 37 30 36Z" fill={hair}/><path d="M29 33Q23 60 33 72L30 83Q15 60 25 31Z" fill={hair}/>{!bob && <path d="M67 31Q74 61 66 81L76 83Q83 50 73 29Z" fill={hair}/>}</> : curly ? <><path d="M30 39L27 28Q28 17 41 15Q61 10 70 25L70 39L64 32L62 26Q48 31 37 27L35 38Z" fill={hair}/>{[30,38,46,55,63,68].map((x,i)=><circle key={x} cx={x} cy={23 - Math.sin(i)*5} r={7} fill={hair}/>)}</> : <path d="M30 39L27 27Q27 14 42 14Q63 10 72 24L70 39L65 34L64 26Q46 30 36 24L35 38Z" fill={hair}/>}
        <path d="M36 41Q40 38 45 40M55 40Q60 38 64 41" stroke={hair} strokeWidth={2.2} strokeLinecap="round"/>
        <ellipse cx="41" cy="45" rx="2" ry="2.3" fill="#29241f"/><ellipse cx="59" cy="45" rx="2" ry="2.3" fill="#29241f"/>
        <circle cx="41.5" cy="44.4" r=".6" fill="#fff"/><circle cx="59.5" cy="44.4" r=".6" fill="#fff"/>
        <path d="M50 45L48 53L52 54" stroke="#754c35" opacity=".35" strokeWidth="1.4" strokeLinecap="round"/>
        {beard && <><path d="M32 49Q35 54 39 53L43 57Q50 54 57 57L62 53Q66 54 68 49L66 60Q59 71 50 71Q40 70 34 60Z" fill={hair} opacity=".92"/><path d="M44 58Q50 61 56 58L53 63H47Z" fill={skin}/></>}
        <path d={female ? 'M44 59Q50 63 56 59' : 'M45 59Q50 62 55 59'} stroke={female ? '#a95f58' : '#6f493d'} strokeWidth="1.7" strokeLinecap="round"/>
        <path d="M45 59H55" stroke="#fff5e9" strokeWidth="1.2" strokeLinecap="round" opacity=".75"/>
        {female && <><circle cx="31" cy="53" r="1.7" fill="#efd59c"/><circle cx="69" cy="53" r="1.7" fill="#efd59c"/><ellipse cx="38" cy="52" rx="4" ry="2" fill="#cf7e6e" opacity=".22"/><ellipse cx="62" cy="52" rx="4" ry="2" fill="#cf7e6e" opacity=".22"/></>}
        {glasses && <><rect x="33" y="40" width="14" height="11" rx="4" stroke="#1c2428" strokeWidth="2"/><rect x="53" y="40" width="14" height="11" rx="4" stroke="#1c2428" strokeWidth="2"/><path d="M47 44H53M29 42H33M67 42H71" stroke="#1c2428" strokeWidth="2"/></>}
        <path d="M24 91L22 105M75 91L78 105" stroke="#000" opacity=".12" strokeWidth="2"/>
        <ellipse cx="45" cy="33" rx="10" ry="3" fill="#fff" opacity=".025"/>
      </g>
      <circle cx="50" cy="50" r="49.3" stroke="#fff" strokeOpacity=".1" strokeWidth="1.4"/>
    </svg>
  );
}

export default Avatar;
