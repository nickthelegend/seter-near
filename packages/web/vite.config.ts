import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// The app reads the recorded testnet deployment and run (../../deployments) at build time.
// public/art is listed at build time so the app only references images that exist (restart the dev server after adding art).
const art = readdirSync(resolve(import.meta.dirname, 'public/art')).filter((f) => /\.(png|webp|jpe?g)$/i.test(f)).sort();
export default defineConfig({ plugins: [react()], define: { __ART__: JSON.stringify(art) }, server: { port: 5201, strictPort: true, fs: { allow: ['../..'] } }, preview: { port: 5201, strictPort: true } });
