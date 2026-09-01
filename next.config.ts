import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
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
