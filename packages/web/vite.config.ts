import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// The app reads the recorded testnet deployment and run (../../deployments) at build time.
export default defineConfig({ plugins: [react()], server: { port: 5201, strictPort: true, fs: { allow: ['../..'] } }, preview: { port: 5201, strictPort: true } });
