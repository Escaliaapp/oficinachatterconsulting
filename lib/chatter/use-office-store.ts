'use client';

import { useEffect } from 'react';
import { create } from 'zustand';
import { commandAgent, createOfficeState, setAgentEnabled, stepSimulation } from './simulation';
import { OFFICE_STORAGE_KEY, restoreOfficeState, serializeOfficeState, updateEmployeeProfile } from './persistence';
import type { AgentCommand, Employee, OfficeState } from './types';

interface OfficeStore {
  state: OfficeState;
  ready: boolean;
  storageError: boolean;
  select: (id: string | null) => void;
  command: (id: string, action: AgentCommand) => void;
  togglePause: () => void;
  setSpeed: (speed: 1 | 2 | 4) => void;
  saveEmployee: (employee: Employee) => void;
  enableAgent: (id: string, enabled: boolean) => void;
  reset: () => void;
}

const office = create<OfficeStore>((set) => ({
  state: createOfficeState(), ready: false, storageError: false,
  select: selectedId => set(s => ({state:{...s.state,selectedId}})),
  command: (id,action) => set(s=>({state:commandAgent(s.state,id,action)})),
  togglePause: ()=>set(s=>({state:{...s.state,paused:!s.state.paused}})),
  setSpeed: speed=>set(s=>({state:{...s.state,speed}})),
  saveEmployee: employee=>set(s=>({state:updateEmployeeProfile(s.state,employee.id,employee)})),
  enableAgent: (id,enabled)=>set(s=>({state:setAgentEnabled(s.state,id,enabled)})),
  reset: ()=>set({state:createOfficeState()}),
}));

/** Rendering and persistence are adapters around the pure, replaceable domain engine. */
export function useOffice() {
  const snapshot = office();
  useEffect(()=>{
    try {
      const state=restoreOfficeState(localStorage.getItem(OFFICE_STORAGE_KEY));
      // Respect reduced motion on a new office, while preserving an explicit saved preference.
      if(!localStorage.getItem(OFFICE_STORAGE_KEY)&&matchMedia('(prefers-reduced-motion: reduce)').matches)state.paused=true;
      office.setState({state,ready:true});
    } catch { office.setState({ready:true,storageError:true}); }
    const step=window.setInterval(()=>{
      if(document.visibilityState==='hidden')return;
      const current=office.getState();
      if(current.ready&&!current.state.paused)office.setState({state:stepSimulation(current.state,.2)});
    },200);
    const save=()=>{
      if(!office.getState().ready)return;
      try{localStorage.setItem(OFFICE_STORAGE_KEY,serializeOfficeState(office.getState().state));}
      catch{office.setState({storageError:true});}
    };
    const saveInterval=window.setInterval(save,2500);
    const unsubscribe=office.subscribe((current,previous)=>{
      if(current.ready&&(current.state.employees!==previous.state.employees||current.state.paused!==previous.state.paused||current.state.speed!==previous.state.speed))save();
    });
    window.addEventListener('pagehide',save);
    return()=>{save();clearInterval(step);clearInterval(saveInterval);unsubscribe();window.removeEventListener('pagehide',save);};
  },[]);
  return snapshot;
}
