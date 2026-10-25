import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths so the build works under any sub-path
  // (e.g. https://<user>.github.io/flylocal/) as well as localhost.
  base: './',
  server: {
    // Web Serial needs a secure context: localhost counts, LAN IPs do not.
    host: 'localhost',
    port: 5173,
  },
});
