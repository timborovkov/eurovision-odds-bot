/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['@prisma/client', '@polymarket/real-time-data-client'],
};

export default nextConfig;
