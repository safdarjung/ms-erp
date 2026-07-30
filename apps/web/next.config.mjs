/** @type {import('next').NextConfig} */
const nextConfig = {
  // Consume workspace packages as TS source (no separate build step).
  transpilePackages: ['@ms/core', '@ms/db'],
  // Keep server-only libs out of the bundle.
  serverExternalPackages: ['postgres', 'bcryptjs'],
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
