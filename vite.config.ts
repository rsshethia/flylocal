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
  preview: {
    // PaaS containers receive the public hostname in the Host header;
    // Vite 6 blocks unknown hosts, so allow-list the Render domain.
    host: '0.0.0.0',
    allowedHosts: ['.onrender.com'],
  },
});
