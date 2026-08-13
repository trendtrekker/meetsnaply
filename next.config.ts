import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // There is a stray package-lock.json in the parent directory tree, which
  // makes Turbopack infer the home directory as the workspace root. Pin it.
  turbopack: {
    root: path.resolve(),
  },
};

export default nextConfig;
