import type { NextConfig } from 'next';
const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    const dev = process.env.NODE_ENV !== 'production';
    return [{ source: '/:path*', headers: [
      {key:'X-Content-Type-Options',value:'nosniff'},
      {key:'X-Frame-Options',value:'DENY'},
      {key:'Referrer-Policy',value:'strict-origin-when-cross-origin'},
      {key:'Permissions-Policy',value:'camera=(), microphone=(), geolocation=()'},
      {key:'Content-Security-Policy',value:`default-src 'self'; script-src 'self' 'unsafe-inline' ${dev ? "'unsafe-eval'" : ''}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://*.supabase.co; media-src 'self' blob: https://*.supabase.co; font-src 'self'; connect-src 'self' https://*.supabase.co wss://*.supabase.co; frame-ancestors 'none'; base-uri 'self'; form-action 'self' https://checkout.stripe.com https://billing.stripe.com; object-src 'none'`},
    ]}];
  },
};
export default nextConfig;
