'use client';

import { Avatar } from './avatar';
import type { Employee } from '@/lib/chatter/types';

export type ConversationEntry = { id:string; thread:string; author:string; text:string; kind:string; time:string };

export default function ConversationLog({entries,employees,thread}:{entries:ConversationEntry[];employees:Employee[];thread?:string}) {
  const groups=new Map<string,ConversationEntry[]>();
  for(const entry of entries){
    if(thread&&entry.thread!==thread)continue;
    const group=groups.get(entry.thread)??[];
    group.push(entry);groups.set(entry.thread,group);
  }
  return <div className="hq-conversation-log">
    <p>Propuestas simuladas del equipo · Historial guardado en este navegador.</p>
    {!groups.size&&<p>Las frases aparecerán aquí cuando el equipo empiece a conversar.</p>}
    {[...groups].reverse().map(([id,group])=><section className="hq-conversation-block" key={id}>
      <header><strong>{group[0].kind}</strong><small>{group[0].time}</small></header>
      <p>{[...new Set(group.map(e=>e.author))].map(id=>employees.find(e=>e.id===id)?.name??id).join(' · ')}</p>
      {group.map(entry=>{const employee=employees.find(e=>e.id===entry.author);return <div className="hq-message" key={entry.id}>
        {employee&&<Avatar employee={employee} size={30}/>}<div><strong>{employee?.name??entry.author}<time>{entry.time}</time></strong><p>{entry.text}</p></div>
      </div>;})}
    </section>)}
  </div>;
}
