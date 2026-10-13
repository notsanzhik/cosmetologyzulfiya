import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
await mkdir(resolve(root, 'dist/pages'), { recursive: true });
await cp(resolve(root, 'dist/client'), resolve(root, 'dist/pages'), { recursive: true });
// Pages запускает тот же сервер. База, защита записи и Telegram остаются общими.
const worker = await readFile(resolve(root, 'dist/server/index.js'), 'utf8');
await writeFile(resolve(root, 'dist/pages/_worker.js'), worker);
await writeFile(resolve(root, 'dist/pages/_routes.json'), JSON.stringify({ version: 1, include: ['/*'], exclude: [] }));
// Vite создаёт перенаправление для Worker. Pages получает своё, чтобы не подхватить родительский конфиг.
await mkdir(resolve(root, 'pages/.wrangler/deploy'), { recursive: true });
await writeFile(resolve(root, 'pages/.wrangler/deploy/config.json'), JSON.stringify({ configPath: '../../wrangler.jsonc' }));
console.log('Pages: интерфейс и сервер подготовлены в dist/pages. Секреты не копировались.');
