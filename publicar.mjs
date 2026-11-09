// Publica en Instagram la próxima publicación de cola.json cuya fecha ya llegó.
// Lo corre GitHub Actions cada 15 minutos. Publica una sola por vez.
//   node publicar.mjs           publica de verdad
//   node publicar.mjs --probar  prepara la imagen en Instagram pero no la publica
import { readFileSync, writeFileSync } from 'node:fs';

const API = 'https://graph.facebook.com/v24.0';
const { IG_TOKEN, IG_USER_ID, IMG_BASE } = process.env;
const probar = process.argv.includes('--probar');

if (!IG_TOKEN || !IG_USER_ID || !IMG_BASE) {
  console.error('Faltan IG_TOKEN, IG_USER_ID o IMG_BASE.');
  process.exit(1);
}

async function llamar(metodo, ruta, params = {}) {
  const body = new URLSearchParams({ ...params, access_token: IG_TOKEN });
  const url = metodo === 'GET' ? `${API}/${ruta}?${body}` : `${API}/${ruta}`;
  const r = await fetch(url, metodo === 'GET' ? {} : { method: 'POST', body });
  const j = await r.json();
  if (j.error) throw new Error(`${ruta}: ${j.error.message}`);
  return j;
}

const esperar = (ms) => new Promise((ok) => setTimeout(ok, ms));

const cola = JSON.parse(readFileSync('cola.json', 'utf8'));
const ahora = Date.now();
const post = cola
  .filter((p) => p.estado === 'pendiente' && (probar || Date.parse(p.fecha) <= ahora))
  .sort((a, b) => Date.parse(a.fecha) - Date.parse(b.fecha))[0];

if (!post) {
  console.log('Nada para publicar todavía.');
  process.exit(0);
}

console.log(`${probar ? 'Probando' : 'Publicando'}: ${post.id}`);
const contenedor = await llamar('POST', `${IG_USER_ID}/media`, {
  image_url: `${IMG_BASE}/${post.imagen}`,
  caption: post.texto,
});

let estado = '';
for (let i = 0; i < 20 && estado !== 'FINISHED'; i++) {
  if (i) await esperar(3000);
  ({ status_code: estado } = await llamar('GET', contenedor.id, { fields: 'status_code' }));
  if (estado === 'ERROR') throw new Error('Instagram no pudo procesar la imagen.');
}
if (estado !== 'FINISHED') throw new Error(`La imagen quedó en estado ${estado}.`);

if (probar) {
  console.log('Prueba OK: Instagram aceptó la imagen y el texto. No se publicó nada.');
  process.exit(0);
}

const { id } = await llamar('POST', `${IG_USER_ID}/media_publish`, { creation_id: contenedor.id });
const { permalink } = await llamar('GET', id, { fields: 'permalink' });

Object.assign(post, { estado: 'publicada', publicada: new Date().toISOString(), link: permalink });
writeFileSync('cola.json', JSON.stringify(cola, null, 2) + '\n');
console.log(`Publicada: ${permalink}`);
