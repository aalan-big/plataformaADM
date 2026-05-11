/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['pg', '@prisma/adapter-pg'],
};

export default nextConfig;
