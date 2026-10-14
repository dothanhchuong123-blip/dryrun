import fs from "node:fs";
import path from "node:path";

/**
 * Copy any ../fixtures/replays/*.jsonl files into ./public/replays/ at build/dev startup
 * so static export and the browser mock/replay client can serve recorded JSONL runs directly.
 */
function syncReplayFixtures() {
  try {
    const repoReplaysDir = path.resolve(process.cwd(), "..", "fixtures", "replays");
    const publicReplaysDir = path.resolve(process.cwd(), "public", "replays");
    if (!fs.existsSync(repoReplaysDir)) {
      return;
    }
    const files = fs.readdirSync(repoReplaysDir).filter((f) => f.endsWith(".jsonl"));
    if (files.length === 0) {
      return;
    }
    fs.mkdirSync(publicReplaysDir, { recursive: true });
    for (const file of files) {
      fs.copyFileSync(
        path.join(repoReplaysDir, file),
        path.join(publicReplaysDir, file)
      );
    }
    fs.writeFileSync(
      path.join(publicReplaysDir, "manifest.json"),
      JSON.stringify({ replays: files.map((f) => f.replace(/\.jsonl$/, "")) }, null, 2)
    );
  } catch {
    // Ignore filesystem errors in restricted environments
  }
}

syncReplayFixtures();

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  images: {
    unoptimized: true,
  },
  reactStrictMode: true,
};

export default nextConfig;

