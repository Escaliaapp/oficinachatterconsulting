'use client';
import { useEffect } from 'react';
export default function ErrorPage({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { /* Error details intentionally stay out of public telemetry. */ }, []);
  return <main className="boot-screen"><h1>Perdimos el hilo por un momento.</h1><p>Intenta volver a la sala. No se confirmará ninguna oferta desde esta pantalla.</p><button className="primary" onClick={reset}>Volver a intentar</button></main>;
}
