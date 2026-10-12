import { createHash } from 'node:crypto';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { viteSingleFile } from 'vite-plugin-singlefile';

// Identifies a deploy. The running page compares it with version.json to
// offer a reload when a newer build is live.
const BUILD_ID = process.env.GITHUB_SHA?.slice(0, 12) || `local-${Date.now()}`;

// The page holds a GitHub token, so lock down what it may load and where it
// may send data. Scripts are allowed by hash only: an injected <script> or
// eval'd string won't run, and nothing can be sent anywhere but GitHub's API.
// Styles stay 'unsafe-inline' because Svelte sets style attributes (label
// colours); CSS can't read the token.
function contentSecurityPolicy() {
  return {
    name: 'prdeck-csp',
    apply: 'build',
    generateBundle: {
      order: 'post',
      handler(_, bundle) {
        const page = bundle['index.html'];
        if (!page) return;
        const html = String(page.source);
        const hashes = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)]
          .map(([, body]) => `'sha256-${createHash('sha256').update(body).digest('base64')}'`);
        const csp = [
          "default-src 'none'",
          `script-src ${hashes.join(' ')}`,
          "style-src 'unsafe-inline'",
          'img-src https://avatars.githubusercontent.com data:',
          "connect-src https://api.github.com 'self'",
          "base-uri 'none'",
          "form-action 'none'",
        ].join('; ');
        page.source = html.replace(
          '<meta charset="UTF-8" />',
          `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`
        );
      },
    },
  };
}

function versionFile() {
  return {
    name: 'prdeck-version',
    apply: 'build',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) });
    },
  };
}

export default defineConfig({
  base: './',
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  plugins: [svelte(), viteSingleFile(), versionFile(), contentSecurityPolicy()],
  build: {
    target: 'es2020',
    cssCodeSplit: false,
    assetsInlineLimit: 100000000,
    chunkSizeWarningLimit: 100000000,
    rollupOptions: { output: { inlineDynamicImports: true } },
  },
});
