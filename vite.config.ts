import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    // Web Serial needs a secure context: localhost counts, LAN IPs do not.
    host: 'localhost',
    port: 5173,
  },
});
