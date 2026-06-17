import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { constants } from 'node:fs';
import { access, copyFile, cp, mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sharedDir = path.resolve(__dirname, '../shared');
const distDir = path.resolve(__dirname, 'dist');

const standaloneFiles = [
  'app.jsx',
  'components.jsx',
  'data.jsx',
  'legal.jsx',
  'screens.jsx',
  'styles.css',
];

function contentType(filePath: string) {
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filePath.endsWith('.js') || filePath.endsWith('.jsx')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.png')) return 'image/png';
  if (filePath.endsWith('.ico')) return 'image/x-icon';
  return 'application/octet-stream';
}

function railbackLandingCompatibility(): Plugin {
  return {
    name: 'railback-landing-compatibility',
    transformIndexHtml(html) {
      return html.replaceAll('../shared/', 'shared/');
    },
    configureServer(server) {
      const watchedPaths = [
        ...standaloneFiles.map((fileName) => path.resolve(__dirname, fileName)),
        sharedDir,
      ];

      server.watcher.add(watchedPaths);
      server.watcher.on('change', (changedPath) => {
        if (
          changedPath.startsWith(`${__dirname}${path.sep}`) ||
          changedPath.startsWith(`${sharedDir}${path.sep}`)
        ) {
          server.ws.send({ type: 'full-reload' });
        }
      });

      server.middlewares.use(async (req, res, next) => {
        if (!req.url) {
          next();
          return;
        }

        const url = new URL(req.url, 'http://localhost');
        const standaloneFileName = decodeURIComponent(url.pathname.replace(/^\//, ''));

        if (standaloneFiles.includes(standaloneFileName)) {
          const filePath = path.resolve(__dirname, standaloneFileName);

          try {
            await access(filePath, constants.R_OK);
            res.setHeader('Content-Type', contentType(filePath));
            res.end(await readFile(filePath));
            return;
          } catch {
            next();
            return;
          }
        }

        if (!url.pathname.startsWith('/shared/')) {
          next();
          return;
        }

        const relativePath = decodeURIComponent(url.pathname.replace(/^\/shared\//, ''));
        const filePath = path.resolve(sharedDir, relativePath);

        if (!filePath.startsWith(`${sharedDir}${path.sep}`)) {
          res.statusCode = 403;
          res.end('Forbidden');
          return;
        }

        try {
          await access(filePath, constants.R_OK);
          res.setHeader('Content-Type', contentType(filePath));
          res.end(await readFile(filePath));
        } catch {
          next();
        }
      });
    },
    async closeBundle() {
      await mkdir(distDir, { recursive: true });

      await Promise.all(
        standaloneFiles.map((fileName) =>
          copyFile(path.resolve(__dirname, fileName), path.resolve(distDir, fileName)),
        ),
      );

      await cp(path.resolve(sharedDir, 'styles'), path.resolve(distDir, 'shared/styles'), {
        recursive: true,
      });
      await mkdir(path.resolve(distDir, 'shared/components'), { recursive: true });
      await copyFile(
        path.resolve(sharedDir, 'components/Button.css'),
        path.resolve(distDir, 'shared/components/Button.css'),
      );
      await cp(path.resolve(sharedDir, 'assets'), path.resolve(distDir, 'shared/assets'), {
        recursive: true,
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), railbackLandingCompatibility()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
  server: {
    fs: {
      allow: [__dirname, sharedDir],
    },
  },
});
