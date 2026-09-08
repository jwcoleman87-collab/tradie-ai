import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  poweredByHeader: false,
  headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: "frame-ancestors 'self'" },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
      {
        source: '/api/:path*',
        headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
      },
    ];
  },
  turbopack: {
    root: process.cwd(),
  },
  // Skill instructions are runtime data. Include them in every API function so
  // the managed agent definitions remain available after Vercel bundles it.
  outputFileTracingIncludes: {
    '/api/*': ['./skills/**/*.md'],
  },
};

export default nextConfig;
