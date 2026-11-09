import type { NextConfig } from 'next';
import path from 'node:path';

const config: NextConfig = {
  output: 'standalone',
  // monorepo: trace dependencies from the repository root
  outputFileTracingRoot: path.join(__dirname, '../../'),
  poweredByHeader: false,
};

export default config;
