import type { Metadata } from 'next';
import './globals.css';
import './chatter.css';

export const metadata: Metadata = {
  title: 'Chatter HQ — Tu agencia, en movimiento',
  description: 'La oficina virtual de Chatter Consulting. Conoce a tu equipo, explora sus espacios y dirige una agencia que cobra vida.',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
