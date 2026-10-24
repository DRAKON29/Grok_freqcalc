/** @type {import('next').NextConfig} */
const nextConfig = {
  async headers() {
    return [
      {
        // Apply to all pages in the app
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            // Allow any site to embed this page in an <iframe>
            value: "frame-ancestors *;",
          },
          // NOTE: X-Frame-Options is legacy and does not support a wildcard;
          // if your platform injects X-Frame-Options: SAMEORIGIN you may need
          // to remove/override it via platform settings.
        ],
      },
    ];
  },
  images: {
    remotePatterns: [],
  },
};

export default nextConfig;
