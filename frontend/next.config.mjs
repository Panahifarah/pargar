/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: { ignoreDuringBuilds: true },
  images: {
    // Default "attachment" can prevent some clients from rendering /_next/image in <img>.
    contentDispositionType: "inline",
  },
  async redirects() {
    return [
      // Student self-service password recovery is disabled.
      { source: "/recovery", destination: "/login", permanent: false },
    ];
  },
  async headers() {
    return [
      {
        source: "/c/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow, noarchive" }],
      },
    ];
  },
};

export default nextConfig;