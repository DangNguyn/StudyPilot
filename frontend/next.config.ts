import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Web cần đăng nhập nên mọi trang vẽ ở trình duyệt sau khi biết người dùng là ai.
  // Chỉ kiểm tra "instant navigation" ở trang nào tự khai báo `instant`, để hết cảnh báo ở mọi trang.
  experimental: {
    instantInsights: {
      validationLevel: "manual-warning",
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
