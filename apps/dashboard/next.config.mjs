/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Display types are duplicated into src/types.ts (see README "Deviations"),
  // so we do NOT transpile @nightshift/schema here — the dashboard has no
  // runtime dependency on the schema package. If you later switch to importing
  // it directly, add: transpilePackages: ["@nightshift/schema"].
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
