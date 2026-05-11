/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@startbig/database', '@startbig/schemas', '@startbig/ui'],
  serverExternalPackages: ['@prisma/client', 'pg', '@prisma/adapter-pg'],
};

export default nextConfig;
